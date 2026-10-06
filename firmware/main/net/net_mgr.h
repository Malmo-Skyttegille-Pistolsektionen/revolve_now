#pragma once

#include <string>

// The network the HTTP server is served over. Two implementations, chosen at
// build time by CONFIG_RT_NET_OPENETH and selected in main/CMakeLists.txt:
//
//   wifi_mgr.cpp  esp_wifi station, a W5500 if one is wired, and the setup
//                 portal fallback (the board)
//   eth_mgr.cpp   OpenCores Ethernet + DHCP           (CONFIG_RT_NET_OPENETH)
//
// The OpenCores MAC exists only in QEMU, which does not emulate WiFi - see
// docs/QEMU.md. Both drive the wired side through net/ethernet.h.
namespace net_mgr {

enum class Result {
  kConnected,    // the device holds an address and can be served
  kSetupPortal,  // no usable network; run_setup_portal() is the next step
};

// Brings the interfaces up and blocks until one of them has an address, or
// until the implementation gives up.
//
// On the board: starts Ethernet if a W5500 answers, and joins the provisioned
// WiFi network (NVS, falling back to the Kconfig defaults). Whichever gets an
// address first returns kConnected; the other carries on in the background,
// and the server answers on both. Only when neither can - the WiFi join failed
// or has nothing to join, and Ethernet has no lease either - does it return
// kSetupPortal; the caller must not start the normal server in that case.
// Once joined, WiFi reconnection is unbounded: the retry budget bounds the
// *initial* association only. A device that gave up mid-session would sit
// powered on and unreachable, which on a range is the worst of both outcomes.
Result connect();

// The out-of-box / lost-network path, valid only after connect() returned
// kSetupPortal. Never returns: on WiFi it serves the SoftAP captive portal
// until credentials are saved and then reboots.
[[noreturn]] void run_setup_portal();

// Dotted-quad address once connected, empty before that: the Ethernet one when
// that interface can serve, otherwise the station's. Feeds GET
// /api/v2/diagnostics/info, and is read from the httpd task.
std::string ip_address();

// The station's own address, empty without one and always on the Ethernet
// build. GET /api/v2/wifi reports it; the CORS allowlist takes it beside the
// Ethernet one.
std::string wifi_ip_address();

// The SSID currently associated, and its signal strength in dBm. Empty and 0
// when not associated, and always so on the Ethernet build - QEMU emulates no
// radio. For the serial console's `status`, where "which of the configured
// networks did it actually join" is the question at the range.
std::string ssid();
int rssi();

// Whether this build has a radio at all: false on the Ethernet build, where
// the two answers above are constants rather than readings. GET /api/v2/wifi
// reports it so a client can tell "no radio" from "firmware older than this
// endpoint" - both of which would otherwise look like an empty SSID.
bool radio_present();

// "30:ed:a0:a8:ab:78" for the station interface, empty where there is none.
// The form a router's client list and a MAC filter identify this device by,
// which is how the question gets asked when a device will not join.
std::string mac_address();

}  // namespace net_mgr
