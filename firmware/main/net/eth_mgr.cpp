// ============================================================================
//  main/net/eth_mgr.cpp
//  The CONFIG_RT_NET_OPENETH implementation of net_mgr: OpenCores Ethernet,
//  brought up through the same ethernet module a W5500 uses on the board.
//
//  Built instead of wifi_mgr.cpp when CONFIG_RT_NET_OPENETH is on, which is
//  the QEMU profile (sdkconfig.defaults.qemu) - QEMU emulates no WiFi radio,
//  so the guest reaches the outside world through the OpenCores MAC the
//  emulator maps onto the EMAC register window. The MAC does not exist on any
//  real ESP32-S3; a build with this option on is a simulator build only.
//
//  There is no setup portal and no NVS credential here: SLIRP hands out an
//  address over DHCP (10.0.2.15 by default), so there is nothing to provision.
//  See docs/QEMU.md.
// ============================================================================
#include <string>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "ethernet.h"
#include "net_common.h"
#include "net_mgr.h"

namespace net_mgr {
namespace {

const char *TAG = "eth";

// SLIRP links at once and answers DHCP in milliseconds. The wait exists so a
// broken -nic argument shows up as one loud line rather than a boot that hangs
// forever with no server and no explanation.
constexpr TickType_t kLinkGrace = pdMS_TO_TICKS(5000);
constexpr TickType_t kDhcpTimeout = pdMS_TO_TICKS(30000);

}  // namespace

// No radio under QEMU, so there is no network to name and no signal to report.
std::string ssid() {
  return "";
}

int rssi() {
  return 0;
}

bool radio_present() {
  return false;
}

// Empty rather than the Ethernet MAC. The field it feeds is the station's, and
// answering with a different interface's address would be a plausible-looking
// wrong answer to "which client on the router is this device".
std::string mac_address() {
  return "";
}

std::string wifi_ip_address() {
  return "";
}

Result connect() {
  net_common::init();
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());

  if (!ethernet::start()) {
    ESP_LOGE(TAG, "The emulated Ethernet did not start - starting the server anyway");
  } else if (!ethernet::wait_for_address(kLinkGrace, kDhcpTimeout)) {
    // The DHCP client keeps retrying, so the server is still worth starting -
    // it just is not reachable yet, and ip_address() stays empty until it is.
    ESP_LOGE(TAG, "No DHCP lease after 30 s - starting the server anyway");
  }

  // Under QEMU's SLIRP the host cannot see multicast DNS - reach the guest at
  // the forwarded localhost port instead. Started regardless, as on the board.
  net_common::start_mdns();
  return Result::kConnected;
}

// Unreachable: connect() never returns kSetupPortal on this path. Provided
// because app_main links against the same net_mgr interface either way.
void run_setup_portal() {
  ESP_LOGE(TAG, "No setup portal in the Ethernet build");
  esp_restart();
}

}  // namespace net_mgr
