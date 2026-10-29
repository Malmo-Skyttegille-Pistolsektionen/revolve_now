#include "boot_button.h"

#include <atomic>
#include <mutex>

#include "button_gesture.h"
#include "factory_reset.h"
#include "press_sequence.h"
#include "rgb_led.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace boot_button {
namespace {

const char *TAG = "boot_button";

// GPIO0 on every ESP32-S3 development board we use. Not configurable, and
// deliberately so: the hardware configuration (#144) refuses GPIO0 as an output
// precisely because it is strapping, so there is no world in which this moves
// while remaining the BOOT button.
constexpr gpio_num_t kPin = GPIO_NUM_0;

// The button pulls the pin to ground, so pressed is low.
constexpr int kPressedLevel = 0;

// Fast enough that a deliberate press is never missed, slow enough to be
// invisible: 50 samples a second on a pin nobody touches for weeks.
constexpr int kPollMs = 20;

// How long GPIO0 may read pressed from boot before it is called stuck. Past
// the factory-reset threshold, so a real hold that began the instant the task
// started is never described as a fault.
constexpr int64_t kStuckWarnMs = 15'000;

// How long a press stays good for. Long enough to walk from the button to a
// phone and submit a form, short enough that a press nobody remembers making
// cannot authorise anything.
constexpr int64_t kPressValidMs = 60'000;

// How long the LED shows what three presses did before giving the status back.
constexpr int64_t kOutcomeLedMs = 2'000;

std::atomic<int64_t> s_last_press_ms{0};
std::atomic<bool> s_available{false};
WindowChangedFn s_on_changed = nullptr;
BlockedFn s_blocked = nullptr;

void random_bytes(uint8_t *out, size_t len) {
  esp_fill_random(out, len);
}

// RAM only, so it dies with the boot. Reached from the httpd task (requests)
// and this module's task (presses).
std::mutex s_window_mutex;
rt::ConfigWindow s_window(random_bytes);
// Bumped on every press outcome, so a conflict - which changes neither `open`
// nor the deadline - is still published.
uint32_t s_outcomes = 0;

// What was last published. The deadline as well as the flag: re-arming an
// already-open window does not change `open`, so publishing on that alone
// leaves every browser counting down from a deadline that has moved.
bool s_last_published_open = false;
int64_t s_last_published_until_ms = 0;
uint32_t s_last_published_outcomes = 0;

int64_t now_ms() {
  return esp_timer_get_time() / 1000;
}

bool blocked() {
  return s_blocked != nullptr && s_blocked();
}

void on_unlock_sequence() {
  rt::ConfigWindow::Press outcome;
  {
    std::lock_guard<std::mutex> lock(s_window_mutex);
    outcome = s_window.press(now_ms());
    s_outcomes++;
  }
  switch (outcome) {
    case rt::ConfigWindow::Press::kGranted:
      rgb_led::window_granted();
      ESP_LOGI(TAG, "Configuration window open for %d minutes, for the client that asked",
               static_cast<int>(rt::kConfigWindowMs / 60000));
      break;
    case rt::ConfigWindow::Press::kConflict:
      rgb_led::window_conflict();
      ESP_LOGW(TAG,
               "More than one client asked for the configuration window - opened it for "
               "nobody. Ask again from one device, then press BOOT three times.");
      break;
    case rt::ConfigWindow::Press::kNothingPending:
      ESP_LOGW(TAG,
               "Three presses, but no client asked for the configuration window - ask in "
               "the web app first, then press BOOT three times.");
      break;
  }
}

void task(void *) {
  rt::ButtonGesture gesture;
  rt::PressSequence unlock;
  // Whether the LED is currently borrowed by a hold, so releasing early can
  // give it back. The gesture reports nothing on an abandoned hold - there is
  // no event, only a button that stopped being down.
  bool led_borrowed = false;
  // Said once, and only after long enough that a genuine press cannot explain
  // it. A button the firmware ignores because the pin is stuck would otherwise
  // be indistinguishable from a button that does nothing, and the person
  // holding it has no way to tell which.
  bool warned_stuck = false;
  // When the LED, borrowed to show what three presses did, is given back.
  int64_t outcome_led_until = 0;
  for (;;) {
    const bool pressed = gpio_get_level(kPin) == kPressedLevel;
    switch (gesture.update(pressed, now_ms())) {
      case rt::Gesture::kShortPress:
        // Every press is recorded for the setup portal, which needs proof of
        // presence and takes one (#208). Only a rhythm of three opens the
        // configuration window, which needs proof of intent.
        s_last_press_ms.store(now_ms());
        if (unlock.press(now_ms())) {
          on_unlock_sequence();
          outcome_led_until = now_ms() + kOutcomeLedMs;
        } else {
          ESP_LOGI(TAG, "Button pressed");
        }
        break;
      case rt::Gesture::kHoldArmed:
        // Nothing is destroyed here. The LED is the whole point: a ten-second
        // hold that shows nothing for ten seconds is indistinguishable from a
        // button that does not work, and the person holding it lets go.
        led_borrowed = true;
        rgb_led::hold_armed();
        ESP_LOGW(TAG, "Hold registered - keep holding for %d s to factory reset, or let go now",
                 static_cast<int>(rt::kDefaultFactoryResetMs / 1000));
        break;
      case rt::Gesture::kFactoryReset:
        // Does not return.
        factory_reset::perform("button held");
        break;
      case rt::Gesture::kNone:
        break;
    }

    if (!warned_stuck && gesture.stuck_pressed() && now_ms() > kStuckWarnMs) {
      warned_stuck = true;
      ESP_LOGW(TAG,
               "GPIO%d has read pressed since boot - treating it as stuck, so no gesture will be "
               "acted on. A shorted button, a board without the pull-up, or an emulator.",
               static_cast<int>(kPin));
    }

    if (outcome_led_until != 0 && now_ms() >= outcome_led_until) {
      outcome_led_until = 0;
      if (!led_borrowed) rgb_led::restore();
    }

    if (led_borrowed && !gesture.armed()) {
      led_borrowed = false;
      rgb_led::restore();
      ESP_LOGI(TAG, "Button released - factory reset abandoned");
    }
    // The lapse has no event of its own anywhere else in the system: it is
    // simply a moment passing. Watched here because this task is already awake,
    // and because a window that closed silently would leave every open browser
    // showing a tab that no longer does anything.
    bool open_now;
    int64_t remaining_ms;
    int64_t until_now;
    uint32_t outcomes_now;
    // Asked outside the lock: it reaches into the executor.
    const bool is_blocked = blocked();
    {
      std::lock_guard<std::mutex> lock(s_window_mutex);
      const int64_t now = now_ms();
      open_now = !is_blocked && s_window.open(now);
      remaining_ms = open_now ? s_window.remaining_ms(now) : 0;
      until_now = s_window.until_ms();
      outcomes_now = s_outcomes;
    }
    if (open_now != s_last_published_open || until_now != s_last_published_until_ms ||
        outcomes_now != s_last_published_outcomes) {
      s_last_published_open = open_now;
      s_last_published_until_ms = until_now;
      s_last_published_outcomes = outcomes_now;
      if (s_on_changed != nullptr) {
        s_on_changed(open_now, static_cast<int32_t>(remaining_ms / 1000));
      }
    }

    vTaskDelay(pdMS_TO_TICKS(kPollMs));
  }
}

}  // namespace

void init() {
  gpio_config_t cfg = {};
  cfg.pin_bit_mask = 1ULL << kPin;
  cfg.mode = GPIO_MODE_INPUT;
  // The boards carry an external pull-up on this pin; the internal one is
  // enabled anyway so a bare module without it still reads high when idle
  // rather than floating into phantom presses.
  cfg.pull_up_en = GPIO_PULLUP_ENABLE;
  cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
  cfg.intr_type = GPIO_INTR_DISABLE;

  const esp_err_t err = gpio_config(&cfg);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Could not configure GPIO%d: %s", static_cast<int>(kPin), esp_err_to_name(err));
    return;
  }

  if (xTaskCreate(task, "boot_button", 2560, nullptr, 5, nullptr) != pdPASS) {
    ESP_LOGE(TAG, "Could not start the button task");
    return;
  }

  s_available.store(true);
  ESP_LOGI(TAG, "Watching GPIO%d", static_cast<int>(kPin));
}

bool consume_press() {
  const int64_t at = s_last_press_ms.load();
  if (at == 0) return false;
  if (now_ms() - at > kPressValidMs) return false;
  // Consumed rather than merely read: one press authorises one submission, so
  // a single press cannot be replayed into several.
  s_last_press_ms.store(0);
  return true;
}

bool available() {
  return s_available.load();
}

void on_window_changed(WindowChangedFn callback) {
  s_on_changed = callback;
}

void block_when(BlockedFn condition) {
  s_blocked = condition;
}

std::string request_window(const std::string &presented) {
  std::lock_guard<std::mutex> lock(s_window_mutex);
  return s_window.request(presented, now_ms());
}

WindowStatus window_status(const std::string &token) {
  using State = rt::ConfigWindow::State;
  // A run holds an open window shut; a request can still wait through one.
  const bool is_blocked = blocked();
  // A window with no button never closes, so there is no countdown to show.
  // Reported as the whole window rather than 0: "unlocked for 0:00" is a
  // contradiction, and it is what the UI renders literally.
  if (!s_available.load()) {
    if (is_blocked) return {State::kClosed, 0};
    return {State::kOpen, static_cast<int32_t>(rt::kConfigWindowMs / 1000)};
  }
  int64_t remaining_ms = 0;
  State state;
  {
    std::lock_guard<std::mutex> lock(s_window_mutex);
    state = s_window.state(token, now_ms(), &remaining_ms);
  }
  if (is_blocked && (state == State::kOpen || state == State::kElsewhere)) {
    return {State::kClosed, 0};
  }
  return {state, static_cast<int32_t>(remaining_ms / 1000)};
}

bool config_window_open(const std::string &token) {
  // Blocking comes first, whatever the button situation: a run holds the window
  // shut on every build, as the contract and the mock say.
  if (blocked()) return false;
  // A build with no button has no way to open the window, and refusing every
  // change on it would make the device unconfigurable rather than safe.
  if (!s_available.load()) return true;
  std::lock_guard<std::mutex> lock(s_window_mutex);
  return s_window.holds(token, now_ms());
}

bool presence_window_open(const std::string &token) {
  if (!s_available.load()) return false;
  std::lock_guard<std::mutex> lock(s_window_mutex);
  return s_window.holds(token, now_ms());
}

}  // namespace boot_button
