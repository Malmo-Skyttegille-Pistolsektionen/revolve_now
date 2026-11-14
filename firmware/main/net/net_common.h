#pragma once

#include <string>

#include "esp_netif_types.h"

// The part of net_mgr that wifi_mgr.cpp and eth_mgr.cpp share. Only one of
// those is built (main/CMakeLists.txt); this is built with either, and also
// defines net_mgr::ip_address(), which picks between WiFi and Ethernet.
namespace net_common {

// Creates the lock behind ip_address(). Call before the IP event can fire.
void init();

// Stores the station's address from IP_EVENT_STA_GOT_IP, returning it as text.
// The Ethernet address is held by the ethernet module.
std::string record_ip(const ip_event_got_ip_t &event);

// Forgets the station's address, on IP_EVENT_STA_LOST_IP.
void clear_ip();

// The station's address, empty when it has none.
std::string wifi_ip();

// Announces <hostname>.local and its HTTP service; logs and carries on if mDNS
// cannot start.
void start_mdns();

}  // namespace net_common
