#pragma once

#include <string>

// The control lock's verifier in NVS (D-51) - a salted hash, never the
// password. Beside the hardware configuration in the `rotation` namespace,
// so a factory reset, which erases the whole partition, takes it too.
namespace control_lock_store {

// The stored verifier, or empty when the lock was off at the last save.
std::string load();

// False if NVS could not be written; the caller then leaves the lock off
// rather than on in RAM only, which a reboot would silently undo.
bool save(const std::string &verifier);

// False if NVS could not be written; the caller leaves the lock on.
bool erase();

}  // namespace control_lock_store
