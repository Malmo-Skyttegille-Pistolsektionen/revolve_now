#include "targets.h"

#include <string>
#include <vector>

#include "config/hardware_store.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"

namespace targets {
namespace {

const char *TAG = "targets";

struct Bank {
  gpio_num_t pin;
  int level_shown;
  int level_hidden;
  // Latching banks only (#636). `pin` is the show pin; both pins rest at the
  // inactive level, and `level_shown` is the pulse level.
  bool latching;
  gpio_num_t hide_pin;
  int64_t pulse_us;
  esp_timer_handle_t pulse_timer;
  // When the pulse in flight should end. A timer callback that runs after a
  // newer pulse started sees a later deadline and leaves that pulse alone.
  int64_t pulse_end_us;
  // What set() last asked for: a latching relay cannot be read back.
  bool shown;
};

// Latched at init(), not read per call. The pins and their polarities come from
// NVS now (#144), and a value that could move mid-run would leave the old pin
// driving whatever state it was last set to while the new one starts from its
// reset value - with a program possibly running between the two.
std::vector<Bank> s_banks;
bool s_shown_at_boot = true;

// set() runs on the executor's task and a pulse ends on the esp_timer task.
portMUX_TYPE s_pulse_lock = portMUX_INITIALIZER_UNLOCKED;

void end_pulse(void *arg) {
  Bank &bank = *static_cast<Bank *>(arg);
  portENTER_CRITICAL(&s_pulse_lock);
  if (esp_timer_get_time() >= bank.pulse_end_us) {
    gpio_set_level(bank.pin, bank.level_hidden);
    gpio_set_level(bank.hide_pin, bank.level_hidden);
  }
  portEXIT_CRITICAL(&s_pulse_lock);
}

// Show and hide never overlap: the other pin is released before this one is
// driven, which also cuts short a pulse still in flight.
void pulse(Bank &bank, bool shown) {
  esp_timer_stop(bank.pulse_timer);
  portENTER_CRITICAL(&s_pulse_lock);
  gpio_set_level(shown ? bank.hide_pin : bank.pin, bank.level_hidden);
  gpio_set_level(shown ? bank.pin : bank.hide_pin, bank.level_shown);
  bank.pulse_end_us = esp_timer_get_time() + bank.pulse_us;
  portEXIT_CRITICAL(&s_pulse_lock);
  esp_timer_start_once(bank.pulse_timer, bank.pulse_us);
}

void configure_output(gpio_num_t pin) {
  gpio_config_t cfg = {};
  cfg.pin_bit_mask = 1ULL << pin;
  // INPUT_OUTPUT, not OUTPUT: with the input buffer left on, gpio_get_level()
  // reads the real pad voltage rather than the output latch, so a pin that is
  // being held by something external is distinguishable from one the firmware
  // never drove.
  cfg.mode = GPIO_MODE_INPUT_OUTPUT;
  cfg.pull_up_en = GPIO_PULLUP_DISABLE;
  cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
  cfg.intr_type = GPIO_INTR_DISABLE;
  ESP_ERROR_CHECK(gpio_config(&cfg));
}

}  // namespace

void init() {
  const rt::HardwareConfig &hw = hardware_store::current();
  s_shown_at_boot = hw.targets_shown_at_boot;

  s_banks.clear();
  s_banks.reserve(hw.banks.size());
  for (const rt::TargetBank &configured : hw.banks) {
    Bank bank = {};
    bank.pin = static_cast<gpio_num_t>(configured.gpio);
    // Active low means a low level opens the BC547B and shows the bank - or,
    // on a latching bank, that the pulse is a low one.
    bank.level_shown = configured.active_low ? 0 : 1;
    bank.level_hidden = configured.active_low ? 1 : 0;
    bank.latching = configured.drive == rt::BankDrive::kLatching;
    bank.hide_pin = static_cast<gpio_num_t>(configured.hide_gpio);
    bank.pulse_us = static_cast<int64_t>(configured.pulse_ms) * 1000;
    bank.shown = s_shown_at_boot;
    s_banks.push_back(bank);
  }

  // The latch first, while the output driver is still off. gpio_config() turns
  // the driver on with the latch at its reset value of 0, which on an active-low
  // board is the shown level - so configuring first drives "shown" for the gap
  // before set() lands. Harmless when that is the boot state anyway, wrong when
  // it is not.
  //
  // gpio_set_level() writes the output register whether or not the pad is an
  // output yet, so the value is already correct the moment the driver is
  // enabled and the pin never drives shown at all. Per bank, so no pin presents
  // an intermediate level however many there are. A latching bank's pins start
  // released; set() below sends the pulse.
  for (Bank &bank : s_banks) {
    if (!bank.latching) {
      gpio_set_level(bank.pin, s_shown_at_boot ? bank.level_shown : bank.level_hidden);
      configure_output(bank.pin);
      continue;
    }
    gpio_set_level(bank.pin, bank.level_hidden);
    gpio_set_level(bank.hide_pin, bank.level_hidden);
    configure_output(bank.pin);
    configure_output(bank.hide_pin);

    // s_banks is not resized after this, so the pointer stays valid.
    esp_timer_create_args_t args = {};
    args.callback = end_pulse;
    args.arg = &bank;
    args.name = "target_pulse";
    ESP_ERROR_CHECK(esp_timer_create(&args, &bank.pulse_timer));
  }

  // For a level bank, redundant against the pre-config writes above, and kept:
  // it is the call that logs, so the boot record still says what the pins were
  // told to do. For a latching bank it is the boot pulse - the relay kept
  // whatever state it had at power-off, so it has to be told (D-31).
  set(rt::kAllBanksMask, s_shown_at_boot);
}

bool shown_at_boot() {
  return s_shown_at_boot;
}

size_t count() {
  return s_banks.size();
}

int pin(size_t bank) {
  return bank < s_banks.size() ? static_cast<int>(s_banks[bank].pin) : -1;
}

int level(size_t bank) {
  return bank < s_banks.size() ? gpio_get_level(s_banks[bank].pin) : -1;
}

int level_shown(size_t bank) {
  return bank < s_banks.size() ? s_banks[bank].level_shown : -1;
}

bool latching(size_t bank) {
  return bank < s_banks.size() && s_banks[bank].latching;
}

int hide_pin(size_t bank) {
  return latching(bank) ? static_cast<int>(s_banks[bank].hide_pin) : -1;
}

bool shown(size_t bank) {
  return bank < s_banks.size() && s_banks[bank].shown;
}

void set(rt::BankMask bank_mask, bool shown) {
  std::string letters;
  for (size_t i = 0; i < s_banks.size(); i++) {
    if ((bank_mask & rt::bank_bit(i)) == 0) continue;
    Bank &bank = s_banks[i];
    if (bank.latching) {
      pulse(bank, shown);
    } else {
      gpio_set_level(bank.pin, shown ? bank.level_shown : bank.level_hidden);
    }
    bank.shown = shown;
    letters += rt::bank_letter(i);
  }
  if (letters.empty()) return;

  // INFO, not DEBUG: transitions are rare (one per program event) and this is
  // the only record of what the pins were told to do - on hardware it is the
  // first thing to compare against the relay, and under QEMU the serial log is
  // the only effects-layer observation channel (GPIO reads are stubbed).
  ESP_LOGI(TAG, "Targets %s (bank %s)", shown ? "shown" : "hidden", letters.c_str());
}

}  // namespace targets
