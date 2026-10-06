#include "config/hardware_store.h"
#include "net_mgr.h"

#include <algorithm>
#include <cstring>
#include <vector>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "ethernet.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "net_common.h"
#include "restart.h"
#include "rgb_led.h"
#include "setup_portal.h"
#include "wifi_scan.h"
#include "wifi_store.h"

namespace net_mgr {
namespace {

const char *TAG = "wifi";

constexpr int kConnectedBit = BIT0;      // the station holds an address
constexpr int kNetworkFailedBit = BIT1;  // the current network's budget is spent
constexpr int kWifiGaveUpBit = BIT2;     // join task: no network joined this pass
constexpr int kWiredBit = BIT3;          // Ethernet holds an address
constexpr int kKeepTryingBit = BIT4;     // connect(): serving, so keep trying WiFi
constexpr int kStopBit = BIT5;           // connect(): the setup portal takes the radio
constexpr int kStoppedBit = BIT6;        // join task: stopped

// Ethernet comes up in a couple of seconds when a cable is in, and a router
// answers DHCP in a few more. Waited for only when WiFi cannot serve, so these
// delay the setup portal, never a working device.
constexpr TickType_t kLinkGrace = pdMS_TO_TICKS(5000);
constexpr TickType_t kDhcpTimeout = pdMS_TO_TICKS(30000);

// Between passes over the configured networks while Ethernet is serving. The
// initial-join budget still applies within a pass.
constexpr TickType_t kRetryPassDelay = pdMS_TO_TICKS(60000);

EventGroupHandle_t s_events = nullptr;
esp_netif_t *s_netif = nullptr;
std::vector<wifi_store::Credentials> s_networks;
int s_retries = 0;
// Set on the first successful association. After that the retry cap no longer
// applies - see the header: giving up mid-session leaves the device powered on
// and unreachable, needing someone to walk to it and power-cycle it.
bool s_joined_once = false;

// Reconnect backoff, for the after-first-join path only. Observed at the
// range: the router restarted, and the immediate-reconnect loop hammered it
// every ~2.4 s for over a minute without ever getting back on - while a
// laptop on the same SSID had long since reassociated. An AP still booting
// answers those early attempts just well enough to fail them, and retrying
// instantly can also keep the supplicant on stale cached keys instead of
// renegotiating (espressif/arduino-esp32#7968). Doubles per failure, capped
// low enough that a device is never more than half a minute from noticing
// the network came back.
constexpr int64_t kReconnectBackoffFirstMs = 1000;
// The multiplication is done wide. `30 * 1000` is computed in `int` and only
// then widened, which is what bugprone-implicit-widening-of-multiplication-result
// objects to - harmless at these values, and the habit that overflows once the
// operands stop being literals.
constexpr int64_t kReconnectBackoffCapMs = int64_t{30} * 1000;
esp_timer_handle_t s_reconnect_timer = nullptr;
int64_t s_backoff_ms = kReconnectBackoffFirstMs;
// Whether any attempt at the current network got an answer out of the AP.
// Latches the larger retry budget for the rest of that network's attempts.
bool s_budget_answered = false;

// A reason that means the AP heard us and answered - the WPA handshake
// started and timed out, or an auth round expired mid-way. Seen on two
// different routers (an ASUS and a UniFi) on a crowded band: joins that
// reach `run` and then drop with reason 15, twice, before the third
// attempt sticks. Worth more patience than "no such network", because
// retrying is nearly always what fixes it. A wrong password produces the
// same reasons, so the budget is bigger, not infinite - the portal stays
// reachable.
bool ap_answered(uint8_t reason) {
  return reason == WIFI_REASON_AUTH_EXPIRE || reason == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT ||
         reason == WIFI_REASON_HANDSHAKE_TIMEOUT;
}

void on_reconnect_timer(void *) {
  esp_wifi_connect();
}

// The LED shows WiFi's state only while WiFi is what carries the device.
bool wired_serving() {
  return ethernet::has_address();
}

void on_event(void *, esp_event_base_t base, int32_t id, void *data) {
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
    // Started with nothing to join on an Ethernet-only device, so the radio is
    // there to scan and nothing more.
    if (!s_networks.empty()) esp_wifi_connect();
  } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    const auto *event = static_cast<wifi_event_sta_disconnected_t *>(data);

    if (s_joined_once) {
      ESP_LOGW(TAG, "Link lost (reason %d) - reconnecting in %d ms",
               static_cast<int>(event->reason), static_cast<int>(s_backoff_ms));
      if (!wired_serving()) rgb_led::status_joining();
      if (s_reconnect_timer != nullptr &&
          esp_timer_start_once(s_reconnect_timer, s_backoff_ms * 1000) == ESP_OK) {
        s_backoff_ms = std::min<int64_t>(s_backoff_ms * 2, kReconnectBackoffCapMs);
      } else {
        // No timer to wait on: the old behaviour, immediate, beats stopping.
        esp_wifi_connect();
      }
      return;
    }

    // Sticky within one network's attempts: a struggling router alternates
    // "no answer to auth" with "not found in the scan", and a budget that
    // shrank back on the second kind ended a nominal twelve-attempt join at
    // five (seen on hardware). Once any attempt proves the AP is there, the
    // whole join keeps the bigger budget. connect() resets it per network.
    const int base_budget = hardware_store::current().wifi_max_retries;
    if (ap_answered(event->reason)) s_budget_answered = true;
    const int budget = s_budget_answered ? base_budget * 3 : base_budget;
    if (s_retries < budget) {
      s_retries++;
      ESP_LOGW(TAG, "Join attempt %d/%d failed (reason %d)", s_retries, budget,
               static_cast<int>(event->reason));
      if (!wired_serving()) rgb_led::status_joining();
      esp_wifi_connect();
    } else {
      // Out of attempts on this network. Solid red says so until the setup
      // portal takes over, if that is where we end up.
      if (!wired_serving()) rgb_led::status_offline();
      xEventGroupSetBits(s_events, kNetworkFailedBit);
    }
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    const std::string ip = net_common::record_ip(*static_cast<ip_event_got_ip_t *>(data));
    s_retries = 0;
    s_joined_once = true;
    s_backoff_ms = kReconnectBackoffFirstMs;
    rgb_led::status_online();
    ESP_LOGI(TAG, "Connected, IP %s", ip.c_str());
    xEventGroupSetBits(s_events, kConnectedBit);
  } else if (base == IP_EVENT && id == IP_EVENT_STA_LOST_IP) {
    net_common::clear_ip();
  }
}

// Creates the station and its radio without starting it.
void init_station() {
  s_netif = esp_netif_create_default_wifi_sta();
  esp_netif_set_hostname(s_netif, hardware_store::current().hostname.c_str());

  wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

  ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_event,
                                                      nullptr, nullptr));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_event,
                                                      nullptr, nullptr));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_LOST_IP, &on_event,
                                                      nullptr, nullptr));

  const esp_timer_create_args_t timer_args = {.callback = &on_reconnect_timer,
                                              .arg = nullptr,
                                              .dispatch_method = ESP_TIMER_TASK,
                                              .name = "wifi_reconnect",
                                              .skip_unhandled_events = true};
  ESP_ERROR_CHECK(esp_timer_create(&timer_args, &s_reconnect_timer));

  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  // Maximum performance rather than the default modem sleep: the SSE stream is
  // long-lived and power saving adds latency to every state update.
  ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
}

// One pass over the configured networks, each with the full retry budget in
// turn. The radio is started once and reconfigured between attempts -
// stopping and restarting it per network would tear down the netif the DHCP
// client is bound to.
bool join_pass(bool &radio_started) {
  for (size_t i = 0; i < s_networks.size(); i++) {
    const wifi_store::Credentials &creds = s_networks[i];

    wifi_config_t wifi_cfg = {};
    // sizeof, not sizeof-1: the struct is zero-initialised and the field is not
    // required to be NUL-terminated, so an SSID of exactly 32 bytes is legal.
    strncpy(reinterpret_cast<char *>(wifi_cfg.sta.ssid), creds.ssid.c_str(),
            sizeof(wifi_cfg.sta.ssid));
    strncpy(reinterpret_cast<char *>(wifi_cfg.sta.password), creds.password.c_str(),
            sizeof(wifi_cfg.sta.password));

    // The club's network is hidden, which means it never answers a passive scan.
    // An all-channel active scan puts the SSID in the probe request, which is
    // what makes a hidden AP respond at all. WIFI_FAST_SCAN (the default) stops
    // at the first matching AP found passively and would never find it.
    wifi_cfg.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
    wifi_cfg.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;

    // Not ESP_ERROR_CHECK: on a later pass, with Ethernet serving, a scan from
    // the web app can hold the radio, and that must not reboot the device.
    if (esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg) != ESP_OK) {
      ESP_LOGW(TAG, "Radio busy - skipping '%s' this pass", creds.ssid.c_str());
      continue;
    }

    s_retries = 0;
    s_budget_answered = false;
    xEventGroupClearBits(s_events, kConnectedBit | kNetworkFailedBit);

    ESP_LOGI(TAG, "Joining '%s' (%d of %d)", creds.ssid.c_str(), static_cast<int>(i + 1),
             static_cast<int>(s_networks.size()));

    if (!radio_started) {
      // STA_START triggers the first esp_wifi_connect() from the event handler.
      ESP_ERROR_CHECK(esp_wifi_start());
      radio_started = true;
    } else if (esp_wifi_connect() != ESP_OK) {
      ESP_LOGW(TAG, "Radio busy - skipping '%s' this pass", creds.ssid.c_str());
      continue;
    }

    const EventBits_t bits = xEventGroupWaitBits(s_events, kConnectedBit | kNetworkFailedBit,
                                                 pdFALSE, pdFALSE, portMAX_DELAY);
    if ((bits & kConnectedBit) != 0) return true;

    ESP_LOGW(TAG, "Could not join '%s'", creds.ssid.c_str());
  }
  return false;
}

// Joins in the background so that Ethernet, if it gets an address first, does
// not wait for WiFi. After a failed pass connect() decides: keep trying while
// Ethernet serves, or stop so the setup portal can have the radio.
void join_task(void *) {
  bool radio_started = false;
  while (!join_pass(radio_started)) {
    xEventGroupSetBits(s_events, kWifiGaveUpBit);
    const EventBits_t told =
        xEventGroupWaitBits(s_events, kKeepTryingBit | kStopBit, pdFALSE, pdFALSE, portMAX_DELAY);
    if ((told & kStopBit) != 0) {
      xEventGroupSetBits(s_events, kStoppedBit);
      vTaskDelete(nullptr);
    }
    ESP_LOGW(TAG, "No WiFi network joined - serving over Ethernet, trying again in %d s",
             static_cast<int>(pdTICKS_TO_MS(kRetryPassDelay) / 1000));
    vTaskDelay(kRetryPassDelay);
    xEventGroupClearBits(s_events, kWifiGaveUpBit);
  }
  vTaskDelete(nullptr);
}

void on_wired_address() {
  xEventGroupSetBits(s_events, kWiredBit);
}

// While the setup portal serves, a cable that gets an address is a better way
// in than the portal: restart, and the device comes up serving over it.
void restart_on_wired_address() {
  ESP_LOGW(TAG, "Ethernet got an address while the setup portal was up - restarting");
  (void)device_restart::schedule("Ethernet came up during the setup portal");
}

}  // namespace

std::string ssid() {
  wifi_ap_record_t ap = {};
  if (esp_wifi_sta_get_ap_info(&ap) != ESP_OK) return "";
  return std::string(reinterpret_cast<const char *>(ap.ssid));
}

int rssi() {
  wifi_ap_record_t ap = {};
  if (esp_wifi_sta_get_ap_info(&ap) != ESP_OK) return 0;
  return ap.rssi;
}

bool radio_present() {
  return true;
}

std::string mac_address() {
  uint8_t mac[6] = {};
  if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) return {};
  return wifi_scan::bssid_text(mac);
}

std::string wifi_ip_address() {
  return net_common::wifi_ip();
}

Result connect() {
  s_networks = wifi_store::load_all();

  net_common::init();
  s_events = xEventGroupCreate();

  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());

  ethernet::on_address(&on_wired_address);
  const bool wired = ethernet::start();

  // WiFi switched off holds only while the cable serves. Without an address
  // there, WiFi is used anyway: otherwise a board whose cable came out could
  // be reached by nothing, not even the setup portal.
  if (!hardware_store::current().wifi_enabled) {
    if (wired && ethernet::wait_for_address(kLinkGrace, kDhcpTimeout)) {
      ESP_LOGW(TAG, "WiFi switched off - serving over Ethernet only");
      s_networks.clear();
    } else {
      ESP_LOGW(TAG, "WiFi is switched off but Ethernet has no address - using WiFi anyway");
    }
  }

  if (s_networks.empty()) {
    if (wired && ethernet::wait_for_address(kLinkGrace, kDhcpTimeout)) {
      // The radio still comes up, unassociated, so the web app can scan for a
      // network and store one.
      ESP_LOGI(TAG, "Not joining WiFi - serving over Ethernet");
      init_station();
      ESP_ERROR_CHECK(esp_wifi_start());
      net_common::start_mdns();
      return Result::kConnected;
    }
    // Nothing configured anywhere: go straight to the portal rather than
    // burning the retry budget on a placeholder.
    ESP_LOGW(TAG, "No network configured - starting the setup portal");
    return Result::kSetupPortal;
  }

  init_station();
  xTaskCreate(join_task, "wifi_join", 4096, nullptr, 5, nullptr);

  const EventBits_t bits = xEventGroupWaitBits(s_events, kConnectedBit | kWiredBit | kWifiGaveUpBit,
                                               pdFALSE, pdFALSE, portMAX_DELAY);
  bool serving = (bits & (kConnectedBit | kWiredBit)) != 0;
  if (!serving && wired) {
    // WiFi gave up first. The cable gets its chance before the portal does.
    serving = ethernet::wait_for_address(kLinkGrace, kDhcpTimeout);
  }

  if (serving) {
    // A no-op once WiFi has joined; otherwise it keeps trying behind the server.
    xEventGroupSetBits(s_events, kKeepTryingBit);
    net_common::start_mdns();
    return Result::kConnected;
  }

  ESP_LOGE(TAG, "No configured network could be joined - starting the setup portal");
  xEventGroupSetBits(s_events, kStopBit);
  xEventGroupWaitBits(s_events, kStoppedBit, pdFALSE, pdFALSE, portMAX_DELAY);
  // Torn down so the portal can bring the radio up as an AP cleanly.
  esp_wifi_stop();
  esp_wifi_deinit();
  return Result::kSetupPortal;
}

void run_setup_portal() {
  if (ethernet::status().present) ethernet::on_address(&restart_on_wired_address);
  setup_portal::run();
}

}  // namespace net_mgr
