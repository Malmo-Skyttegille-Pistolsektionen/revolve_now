#include "hardware_json.h"

#include <ArduinoJson.h>

#include <vector>

#include "json_util.h"

namespace rt {
namespace {

// One `"name":value` member, with the comma that separates it from the last.
void member(std::string &out, const char *name, const std::string &value) {
  if (out.size() > 1) out += ',';
  out += json_quote(name);
  out += ':';
  out += value;
}

void member(std::string &out, const char *name, int32_t value) {
  member(out, name, std::to_string(value));
}

void member(std::string &out, const char *name, bool value) {
  member(out, name, std::string(value ? "true" : "false"));
}

std::string banks_json(const std::vector<TargetBank> &banks) {
  std::string out = "[";
  for (size_t i = 0; i < banks.size(); ++i) {
    if (i > 0) out += ',';
    out += "{\"gpio\":";
    out += std::to_string(banks[i].gpio);
    out += ",\"activeLow\":";
    out += banks[i].active_low ? "true" : "false";
    out += ",\"name\":";
    out += json_quote(banks[i].name);
    out += '}';
  }
  out += ']';
  return out;
}

}  // namespace

std::string hardware_config_json(const HardwareConfig &config) {
  std::string out = "{";
  member(out, "banks", banks_json(config.banks));
  member(out, "hostname", json_quote(config.hostname));
  member(out, "displayName", json_quote(config.display_name));
  member(out, "targetsShownAtBoot", config.targets_shown_at_boot);
  member(out, "ledGpio", config.led_gpio);
  member(out, "i2sPort", config.i2s_port);
  member(out, "i2sBckGpio", config.i2s_bck_gpio);
  member(out, "i2sWsGpio", config.i2s_ws_gpio);
  member(out, "i2sDoutGpio", config.i2s_dout_gpio);
  member(out, "i2sMclkGpio", config.i2s_mclk_gpio);
  member(out, "httpPort", config.http_port);
  member(out, "wifiMaxRetries", config.wifi_max_retries);
  member(out, "wifiEnabled", config.wifi_enabled);
  member(out, "ethEnabled", config.eth_enabled);
  member(out, "ethSclkGpio", config.eth_sclk_gpio);
  member(out, "ethMosiGpio", config.eth_mosi_gpio);
  member(out, "ethMisoGpio", config.eth_miso_gpio);
  member(out, "ethCsGpio", config.eth_cs_gpio);
  member(out, "ethIntGpio", config.eth_int_gpio);
  member(out, "ethRstGpio", config.eth_rst_gpio);
  out += '}';
  return out;
}

std::string hardware_overrides_json(const HardwareConfig &saved, const HardwareConfig &defaults) {
  std::string out = "{";
  // A bank's name is in the comparison: it is not wiring, but it is a setting
  // somebody chose.
  if (saved.banks != defaults.banks) member(out, "banks", banks_json(saved.banks));
  if (saved.hostname != defaults.hostname) member(out, "hostname", json_quote(saved.hostname));
  if (saved.display_name != defaults.display_name) {
    member(out, "displayName", json_quote(saved.display_name));
  }
  const auto pin = [&](const char *name, int32_t a, int32_t b) {
    if (a != b) member(out, name, a);
  };
  pin("ledGpio", saved.led_gpio, defaults.led_gpio);
  pin("i2sPort", saved.i2s_port, defaults.i2s_port);
  pin("i2sBckGpio", saved.i2s_bck_gpio, defaults.i2s_bck_gpio);
  pin("i2sWsGpio", saved.i2s_ws_gpio, defaults.i2s_ws_gpio);
  pin("i2sDoutGpio", saved.i2s_dout_gpio, defaults.i2s_dout_gpio);
  pin("i2sMclkGpio", saved.i2s_mclk_gpio, defaults.i2s_mclk_gpio);
  pin("httpPort", saved.http_port, defaults.http_port);
  pin("wifiMaxRetries", saved.wifi_max_retries, defaults.wifi_max_retries);
  if (saved.wifi_enabled != defaults.wifi_enabled) member(out, "wifiEnabled", saved.wifi_enabled);
  if (saved.eth_enabled != defaults.eth_enabled) member(out, "ethEnabled", saved.eth_enabled);
  pin("ethSclkGpio", saved.eth_sclk_gpio, defaults.eth_sclk_gpio);
  pin("ethMosiGpio", saved.eth_mosi_gpio, defaults.eth_mosi_gpio);
  pin("ethMisoGpio", saved.eth_miso_gpio, defaults.eth_miso_gpio);
  pin("ethCsGpio", saved.eth_cs_gpio, defaults.eth_cs_gpio);
  pin("ethIntGpio", saved.eth_int_gpio, defaults.eth_int_gpio);
  pin("ethRstGpio", saved.eth_rst_gpio, defaults.eth_rst_gpio);
  out += '}';
  return out;
}

bool same_config(const HardwareConfig &a, const HardwareConfig &b) {
  return same_wiring(a.banks, b.banks) && a.hostname == b.hostname &&
         a.display_name == b.display_name && a.targets_shown_at_boot == b.targets_shown_at_boot &&
         a.led_gpio == b.led_gpio && a.i2s_port == b.i2s_port && a.i2s_bck_gpio == b.i2s_bck_gpio &&
         a.i2s_ws_gpio == b.i2s_ws_gpio && a.i2s_dout_gpio == b.i2s_dout_gpio &&
         a.i2s_mclk_gpio == b.i2s_mclk_gpio && a.http_port == b.http_port &&
         a.wifi_max_retries == b.wifi_max_retries && a.eth_sclk_gpio == b.eth_sclk_gpio &&
         a.eth_mosi_gpio == b.eth_mosi_gpio && a.eth_miso_gpio == b.eth_miso_gpio &&
         a.eth_cs_gpio == b.eth_cs_gpio && a.eth_int_gpio == b.eth_int_gpio &&
         a.eth_rst_gpio == b.eth_rst_gpio && a.wifi_enabled == b.wifi_enabled &&
         a.eth_enabled == b.eth_enabled;
}

PatchError apply_hardware_patch(const char *json, size_t len, HardwareConfig &config) {
  JsonDocument doc;
  if (json == nullptr || deserializeJson(doc, json, len) != DeserializationError::Ok ||
      !doc.is<JsonObject>()) {
    return PatchError::kNotObject;
  }

  if (!doc["targetsShownAtBoot"].isNull()) return PatchError::kSerialOnly;

  // `banks` replaces the whole array - it is an ordered list, and a partial
  // merge of one has no meaning. The count is validate()'s to check.
  if (!doc["banks"].isNull()) {
    if (!doc["banks"].is<JsonArray>()) return PatchError::kBanksNotArray;
    std::vector<TargetBank> banks;
    for (JsonVariant entry : doc["banks"].as<JsonArray>()) {
      if (!entry.is<JsonObject>()) return PatchError::kBankNotObject;
      TargetBank bank;
      bank.gpio = entry["gpio"] | 0;
      bank.active_low = entry["activeLow"] | true;
      bank.name = entry["name"] | "";
      banks.push_back(bank);
    }
    config.banks = banks;
  }

  // Absent fields keep what `config` holds rather than reverting to a compiled
  // default: a client that knows about fewer fields than this firmware must
  // not silently undo the ones it cannot see.
  const auto take = [&](const char *name, auto &field) {
    if (!doc[name].isNull()) field = doc[name] | field;
  };
  take("hostname", config.hostname);
  take("displayName", config.display_name);
  take("ledGpio", config.led_gpio);
  take("i2sPort", config.i2s_port);
  take("i2sBckGpio", config.i2s_bck_gpio);
  take("i2sWsGpio", config.i2s_ws_gpio);
  take("i2sDoutGpio", config.i2s_dout_gpio);
  take("i2sMclkGpio", config.i2s_mclk_gpio);
  take("httpPort", config.http_port);
  take("wifiMaxRetries", config.wifi_max_retries);
  take("wifiEnabled", config.wifi_enabled);
  take("ethEnabled", config.eth_enabled);
  take("ethSclkGpio", config.eth_sclk_gpio);
  take("ethMosiGpio", config.eth_mosi_gpio);
  take("ethMisoGpio", config.eth_miso_gpio);
  take("ethCsGpio", config.eth_cs_gpio);
  take("ethIntGpio", config.eth_int_gpio);
  take("ethRstGpio", config.eth_rst_gpio);
  return PatchError::kNone;
}

const char *patch_error_message(PatchError error) {
  switch (error) {
    case PatchError::kNone:
      return "";
    case PatchError::kNotObject:
      return "Expected a JSON object of hardware configuration fields";
    case PatchError::kSerialOnly:
      return "targetsShownAtBoot changes only from the serial console: "
             "'boot-targets shown' or 'boot-targets hidden'";
    case PatchError::kBanksNotArray:
      return "'banks' must be an array of target banks";
    case PatchError::kBankNotObject:
      return "Each entry in 'banks' must be an object with gpio, activeLow and name";
  }
  return "";
}

}  // namespace rt
