// ============================================================================
//  rt_logic/hardware_json.h
//  HardwareConfig to and from the JSON `/config/hardware` speaks.
//  Host-testable, no NVS and no ESP-IDF.
// ============================================================================
#pragma once

#include <cstddef>
#include <string>

#include "hardware_config.h"

namespace rt {

// Every field, in the shape of the contract's `HardwareConfig`.
std::string hardware_config_json(const HardwareConfig &config);

// Only the fields where `saved` differs from `defaults`, as a
// `HardwareConfigPatch`: what a backup carries (#520). Relative to the
// compiled defaults so that a board built for other hardware keeps its own
// defaults for everything nobody changed. `targetsShownAtBoot` is never in it:
// it is serial-only (D-31), so no patch may carry it.
std::string hardware_overrides_json(const HardwareConfig &saved, const HardwareConfig &defaults);

// Every field, `targets_shown_at_boot` and each pin included: a difference in
// any of them is waiting on a restart.
bool same_config(const HardwareConfig &a, const HardwareConfig &b);

enum class PatchError {
  kNone,
  kNotObject,
  // `targetsShownAtBoot` is present (D-31).
  kSerialOnly,
  kBanksNotArray,
  kBankNotObject,
};

// Applies a `HardwareConfigPatch` document onto `config`: fields it names are
// replaced, fields it omits keep what `config` held. `banks` replaces the
// whole array. Nothing is validated beyond the shape - that is `validate()`'s.
// On an error `config` may be partly patched; callers patch a copy.
PatchError apply_hardware_patch(const char *json, size_t len, HardwareConfig &config);

inline PatchError apply_hardware_patch(const std::string &json, HardwareConfig &config) {
  return apply_hardware_patch(json.data(), json.size(), config);
}

// The `detail` for a refusal.
const char *patch_error_message(PatchError error);

}  // namespace rt
