#pragma once

#include <string>

#include "nvs.h"

namespace storage {

// Reads string `key` into `out`. False when it is absent, empty or unreadable.
inline bool nvs_read_str(nvs_handle_t handle, const char *key, std::string &out) {
  size_t len = 0;
  if (nvs_get_str(handle, key, nullptr, &len) != ESP_OK || len == 0) return false;

  out.resize(len);
  if (nvs_get_str(handle, key, &out[0], &len) != ESP_OK) return false;
  // nvs_get_str counts the NUL; std::string tracks its own length.
  out.resize(len > 0 ? len - 1 : 0);
  return true;
}

}  // namespace storage
