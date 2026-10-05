#include "ethernet.h"

#include <cstdio>

#include "config/hardware_store.h"
#include "esp_eth.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "net_common.h"
#include "rgb_led.h"
#include "sdkconfig.h"

#if CONFIG_RT_NET_OPENETH
#include "esp_eth_mac_openeth.h"
#elif CONFIG_RT_ETH_W5500_ENABLED
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_eth_mac_w5500.h"
#include "esp_eth_phy_w5500.h"
#endif

namespace ethernet {
namespace {

const char *TAG = "eth";

constexpr int kLinkUpBit = BIT0;
constexpr int kGotIpBit = BIT1;

EventGroupHandle_t s_events = nullptr;
esp_eth_handle_t s_eth = nullptr;
void (*s_on_address)() = nullptr;

// Written on the event task, read from the httpd task and the console.
SemaphoreHandle_t s_lock = nullptr;
Status s_status;

#if CONFIG_RT_ETH_W5500_ENABLED && !CONFIG_RT_NET_OPENETH
// SPI2 is the general-purpose host on the S3; SPI0/1 are the module's own
// flash and PSRAM.
constexpr spi_host_device_t kSpiHost = SPI2_HOST;
// How often the driver polls the chip when no INT pin is wired.
constexpr uint32_t kPollPeriodMs = 10;
#endif

template <typename F>
void locked(F &&f) {
  xSemaphoreTake(s_lock, portMAX_DELAY);
  f();
  xSemaphoreGive(s_lock);
}

std::string mac_text(const uint8_t mac[6]) {
  char buf[18];
  snprintf(buf, sizeof(buf), "%02x:%02x:%02x:%02x:%02x:%02x", mac[0], mac[1], mac[2], mac[3],
           mac[4], mac[5]);
  return buf;
}

void on_event(void *, esp_event_base_t base, int32_t id, void *data) {
  if (base == ETH_EVENT && id == ETHERNET_EVENT_CONNECTED) {
    eth_speed_t speed = ETH_SPEED_10M;
    eth_duplex_t duplex = ETH_DUPLEX_HALF;
    esp_eth_ioctl(s_eth, ETH_CMD_G_SPEED, &speed);
    esp_eth_ioctl(s_eth, ETH_CMD_G_DUPLEX_MODE, &duplex);
    locked([&] {
      s_status.link_up = true;
      s_status.speed_mbps = speed == ETH_SPEED_100M ? 100 : 10;
      s_status.full_duplex = duplex == ETH_DUPLEX_FULL;
    });
    xEventGroupSetBits(s_events, kLinkUpBit);
    ESP_LOGI(TAG, "Link up, %d Mbit/s %s duplex", speed == ETH_SPEED_100M ? 100 : 10,
             duplex == ETH_DUPLEX_FULL ? "full" : "half");
  } else if (base == ETH_EVENT && id == ETHERNET_EVENT_DISCONNECTED) {
    // The lease is kept until IP_EVENT_ETH_LOST_IP, but an address on a link
    // that is down cannot serve, so has_address() reads both.
    locked([] {
      s_status.link_up = false;
      s_status.speed_mbps = 0;
      s_status.full_duplex = false;
    });
    xEventGroupClearBits(s_events, kLinkUpBit);
    // Offline only if WiFi is not carrying the device either.
    if (net_common::wifi_ip().empty()) rgb_led::status_offline();
    ESP_LOGW(TAG, "Link down");
  } else if (base == IP_EVENT && id == IP_EVENT_ETH_GOT_IP) {
    const auto *event = static_cast<ip_event_got_ip_t *>(data);
    char buf[16];
    snprintf(buf, sizeof(buf), IPSTR, IP2STR(&event->ip_info.ip));
    locked([&] { s_status.ip = buf; });
    xEventGroupSetBits(s_events, kGotIpBit);
    rgb_led::status_online();
    ESP_LOGI(TAG, "Got IP %s", buf);
    if (s_on_address != nullptr) s_on_address();
  } else if (base == IP_EVENT && id == IP_EVENT_ETH_LOST_IP) {
    locked([] { s_status.ip.clear(); });
    xEventGroupClearBits(s_events, kGotIpBit);
    ESP_LOGW(TAG, "Lost the address");
  }
}

// The MAC and PHY for this build, or false where there is nothing to probe.
// On false nothing is left allocated.
bool make_driver(esp_eth_mac_t **mac, esp_eth_phy_t **phy) {
  eth_mac_config_t mac_cfg = ETH_MAC_DEFAULT_CONFIG();
  eth_phy_config_t phy_cfg = ETH_PHY_DEFAULT_CONFIG();
  // The default is GPIO5, which drives the targets on the PoC.
  phy_cfg.reset_gpio_num = -1;

#if CONFIG_RT_NET_OPENETH
  // QEMU's open_eth answers MII reads for exactly one PHY address and leaves
  // the identifier registers at zero, so ESP_ETH_PHY_ADDR_AUTO - which scans
  // for a non-zero PHYIDR1 - finds nothing. The address is fixed in the model.
  phy_cfg.phy_addr = 1;
  *mac = esp_eth_mac_new_openeth(&mac_cfg);
  *phy = esp_eth_phy_new_generic(&phy_cfg);
  return *mac != nullptr && *phy != nullptr;
#elif CONFIG_RT_ETH_W5500_ENABLED
  const rt::HardwareConfig &hw = hardware_store::current();
  if (hw.eth_cs_gpio == rt::kPinUnused) {
    ESP_LOGI(TAG, "No W5500 configured");
    return false;
  }

  // The driver's INT handler hangs off the shared GPIO ISR service, which
  // nothing else in this firmware installs.
  const esp_err_t isr = gpio_install_isr_service(0);
  if (isr != ESP_OK && isr != ESP_ERR_INVALID_STATE) {
    ESP_LOGE(TAG, "GPIO ISR service unavailable (%s)", esp_err_to_name(isr));
    return false;
  }

  spi_bus_config_t bus = {};
  bus.mosi_io_num = hw.eth_mosi_gpio;
  bus.miso_io_num = hw.eth_miso_gpio;
  bus.sclk_io_num = hw.eth_sclk_gpio;
  bus.quadwp_io_num = -1;
  bus.quadhd_io_num = -1;
  if (spi_bus_initialize(kSpiHost, &bus, SPI_DMA_CH_AUTO) != ESP_OK) {
    ESP_LOGE(TAG, "SPI bus for the W5500 could not be set up");
    return false;
  }

  spi_device_interface_config_t dev = {};
  dev.mode = 0;
  dev.clock_speed_hz = CONFIG_RT_ETH_SPI_CLOCK_MHZ * 1000 * 1000;
  dev.queue_size = 20;
  dev.spics_io_num = hw.eth_cs_gpio;

  eth_w5500_config_t w5500 = ETH_W5500_DEFAULT_CONFIG(kSpiHost, &dev);
  w5500.base.int_gpio_num = hw.eth_int_gpio;
  if (hw.eth_int_gpio == rt::kPinUnused) w5500.base.poll_period_ms = kPollPeriodMs;

  phy_cfg.reset_gpio_num = hw.eth_rst_gpio;
  *mac = esp_eth_mac_new_w5500(&w5500, &mac_cfg);
  *phy = esp_eth_phy_new_w5500(&phy_cfg);
  if (*mac == nullptr || *phy == nullptr) {
    if (*mac != nullptr) (*mac)->del(*mac);
    if (*phy != nullptr) (*phy)->del(*phy);
    spi_bus_free(kSpiHost);
    return false;
  }
  return true;
#else
  (void)mac;
  (void)phy;
  (void)mac_cfg;
  (void)phy_cfg;
  return false;
#endif
}

// Undoes make_driver() after the chip failed to answer.
void free_driver(esp_eth_mac_t *mac, esp_eth_phy_t *phy) {
  mac->del(mac);
  phy->del(phy);
#if CONFIG_RT_ETH_W5500_ENABLED && !CONFIG_RT_NET_OPENETH
  spi_bus_free(kSpiHost);
#endif
}

}  // namespace

bool supported() {
#if CONFIG_RT_NET_OPENETH || CONFIG_RT_ETH_W5500_ENABLED
  return true;
#else
  return false;
#endif
}

bool start() {
  s_lock = xSemaphoreCreateMutex();
  s_events = xEventGroupCreate();

  esp_eth_mac_t *mac = nullptr;
  esp_eth_phy_t *phy = nullptr;
  if (!make_driver(&mac, &phy)) return false;

  esp_eth_config_t eth_cfg = ETH_DEFAULT_CONFIG(mac, phy);
  // This is the probe: installing runs the MAC's init, which reads the W5500's
  // version register and fails when nothing answers on the bus.
  const esp_err_t installed = esp_eth_driver_install(&eth_cfg, &s_eth);
  if (installed != ESP_OK) {
    ESP_LOGW(TAG, "No Ethernet controller answered (%s) - continuing without it",
             esp_err_to_name(installed));
    free_driver(mac, phy);
    s_eth = nullptr;
    return false;
  }

  uint8_t mac_addr[6] = {};
#if !CONFIG_RT_NET_OPENETH
  // A W5500 has no MAC of its own; the chip's eFuse supplies one for Ethernet.
  esp_read_mac(mac_addr, ESP_MAC_ETH);
  esp_eth_ioctl(s_eth, ETH_CMD_S_MAC_ADDR, mac_addr);
#endif
  esp_eth_ioctl(s_eth, ETH_CMD_G_MAC_ADDR, mac_addr);
  locked([&] {
    s_status.present = true;
    s_status.mac = mac_text(mac_addr);
  });

  esp_netif_config_t netif_cfg = ESP_NETIF_DEFAULT_ETH();
  esp_netif_t *netif = esp_netif_new(&netif_cfg);
  esp_netif_set_hostname(netif, hardware_store::current().hostname.c_str());
  ESP_ERROR_CHECK(esp_netif_attach(netif, esp_eth_new_netif_glue(s_eth)));

  ESP_ERROR_CHECK(esp_event_handler_instance_register(ETH_EVENT, ESP_EVENT_ANY_ID, &on_event,
                                                      nullptr, nullptr));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_ETH_GOT_IP, &on_event,
                                                      nullptr, nullptr));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_ETH_LOST_IP, &on_event,
                                                      nullptr, nullptr));

  ESP_ERROR_CHECK(esp_eth_start(s_eth));
  ESP_LOGI(TAG, "Ethernet started, MAC %s", mac_text(mac_addr).c_str());
  return true;
}

bool wait_for_address(TickType_t link_grace, TickType_t dhcp_timeout) {
  if (s_eth == nullptr) return false;
  if ((xEventGroupWaitBits(s_events, kLinkUpBit, pdFALSE, pdFALSE, link_grace) & kLinkUpBit) == 0) {
    ESP_LOGW(TAG, "No Ethernet link");
    return false;
  }
  if ((xEventGroupWaitBits(s_events, kGotIpBit, pdFALSE, pdFALSE, dhcp_timeout) & kGotIpBit) == 0) {
    ESP_LOGW(TAG, "Ethernet link but no DHCP lease");
    return false;
  }
  return true;
}

bool has_address() {
  if (s_eth == nullptr) return false;
  bool up = false;
  locked([&] { up = s_status.link_up && !s_status.ip.empty(); });
  return up;
}

Status status() {
  if (s_lock == nullptr) return {};
  Status copy;
  locked([&] { copy = s_status; });
  return copy;
}

void on_address(void (*callback)()) {
  s_on_address = callback;
}

}  // namespace ethernet
