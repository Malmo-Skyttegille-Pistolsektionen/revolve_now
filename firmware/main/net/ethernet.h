#pragma once

#include <string>

#include "freertos/FreeRTOS.h"

// The wired interface, beside WiFi on a board (#262) and alone under QEMU.
//
// One implementation, two drivers chosen at build time: a W5500 on SPI on the
// board, the emulator's OpenCores MAC with CONFIG_RT_NET_OPENETH. Everything
// above the driver - the netif, DHCP, the events and the status - is shared,
// which is what lets the QEMU contract suite exercise GET /api/v2/ethernet.
namespace ethernet {

struct Status {
  // A controller answered at boot. False with no W5500 wired, or one that did
  // not respond, and on a build without Ethernet support at all.
  bool present = false;
  bool link_up = false;
  // 10 or 100 while the link is up, 0 otherwise.
  int speed_mbps = 0;
  bool full_duplex = false;
  // Dotted quad while the interface holds a lease, empty otherwise.
  std::string ip;
  // "02:00:00:00:00:00" form, empty when not present.
  std::string mac;
};

// Whether this build can have a wired interface at all, whatever is fitted.
bool supported();

// Probes for the controller and, if one answers, starts it with a DHCP client.
// Returns whether it did. Does not wait for the link or a lease - those arrive
// as events. Call once, after esp_netif_init() and the default event loop.
bool start();

// Blocks until the interface holds an address. Gives up after `link_grace` if
// there is still no link (no cable, or nothing at the other end), and after
// `dhcp_timeout` once there is. False at once if start() found nothing.
bool wait_for_address(TickType_t link_grace, TickType_t dhcp_timeout);

// Link up and an address held - the interface can serve right now.
bool has_address();

Status status();

// Called on the event task each time the interface gains an address. One
// callback; a later call replaces it.
void on_address(void (*callback)());

}  // namespace ethernet
