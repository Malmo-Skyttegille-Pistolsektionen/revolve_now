#include "net_common.h"

#include <cstdio>

#include "config/hardware_store.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "mdns.h"
#include "net_mgr.h"

namespace net_common {
namespace {

const char *TAG = "net";

// Written on the event task, read from the main task and from the diagnostics
// handler on the httpd task.
std::string s_ip;
SemaphoreHandle_t s_ip_lock = nullptr;

}  // namespace

void init() {
  s_ip_lock = xSemaphoreCreateMutex();
}

std::string record_ip(const ip_event_got_ip_t &event) {
  char buf[16];
  snprintf(buf, sizeof(buf), IPSTR, IP2STR(&event.ip_info.ip));
  if (s_ip_lock != nullptr) {
    xSemaphoreTake(s_ip_lock, portMAX_DELAY);
    s_ip = buf;
    xSemaphoreGive(s_ip_lock);
  }
  return buf;
}

void start_mdns() {
  if (mdns_init() != ESP_OK) {
    ESP_LOGW(TAG, "mDNS unavailable");
    return;
  }
  mdns_hostname_set(hardware_store::current().hostname.c_str());
  mdns_instance_name_set("Revolve Now");
  mdns_service_add(nullptr, "_http", "_tcp",
                   static_cast<uint16_t>(hardware_store::current().http_port), nullptr, 0);
  ESP_LOGI(TAG, "Reachable at http://%s.local", hardware_store::current().hostname.c_str());
}

}  // namespace net_common

namespace net_mgr {

std::string ip_address() {
  if (net_common::s_ip_lock == nullptr) return {};
  xSemaphoreTake(net_common::s_ip_lock, portMAX_DELAY);
  const std::string copy = net_common::s_ip;
  xSemaphoreGive(net_common::s_ip_lock);
  return copy;
}

}  // namespace net_mgr
