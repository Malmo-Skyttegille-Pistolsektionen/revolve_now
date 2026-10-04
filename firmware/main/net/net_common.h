#pragma once

#include <string>

#include "esp_netif_types.h"

// The part of net_mgr that wifi_mgr.cpp and eth_mgr.cpp share. Only one of
// those is built (main/CMakeLists.txt); this is built with either, and also
// defines net_mgr::ip_address().
namespace net_common {

// Creates the lock behind ip_address(). Call before the IP event can fire.
void init();

// Stores the address from an IP_EVENT_*_GOT_IP event, returning it as text.
std::string record_ip(const ip_event_got_ip_t &event);

// Announces <hostname>.local and its HTTP service; logs and carries on if mDNS
// cannot start.
void start_mdns();

}  // namespace net_common
