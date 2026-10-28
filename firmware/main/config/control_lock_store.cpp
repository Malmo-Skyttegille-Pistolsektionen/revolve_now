#include "control_lock_store.h"

#include "esp_log.h"
#include "nvs.h"

namespace control_lock_store {
namespace {

const char *TAG = "control_lock";

constexpr const char *kNamespace = "rotation";
constexpr const char *kKey = "lock_verifier";

}  // namespace

std::string load() {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READONLY, &handle) != ESP_OK) return {};
  size_t len = 0;
  std::string out;
  if (nvs_get_blob(handle, kKey, nullptr, &len) == ESP_OK && len > 0) {
    out.resize(len);
    if (nvs_get_blob(handle, kKey, out.data(), &len) != ESP_OK) out.clear();
  }
  nvs_close(handle);
  return out;
}

bool save(const std::string &verifier) {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) {
    ESP_LOGE(TAG, "Could not open NVS for writing");
    return false;
  }
  const bool ok = nvs_set_blob(handle, kKey, verifier.data(), verifier.size()) == ESP_OK &&
                  nvs_commit(handle) == ESP_OK;
  nvs_close(handle);
  if (!ok) ESP_LOGE(TAG, "Could not store the control lock");
  return ok;
}

bool erase() {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) {
    ESP_LOGE(TAG, "Could not open NVS for writing");
    return false;
  }
  const esp_err_t erased = nvs_erase_key(handle, kKey);
  const bool ok =
      (erased == ESP_OK || erased == ESP_ERR_NVS_NOT_FOUND) && nvs_commit(handle) == ESP_OK;
  nvs_close(handle);
  if (!ok) ESP_LOGE(TAG, "Could not erase the stored control lock");
  return ok;
}

}  // namespace control_lock_store
