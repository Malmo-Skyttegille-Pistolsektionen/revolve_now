// ============================================================================
//  rt_logic/target_bank.h
//  What a target bank is, and how one is addressed (#207, D-41).
//  Shared by the hardware configuration and the executor; no NVS, no ESP-IDF.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace rt {

// An optional pin that is not driven at all.
constexpr int32_t kPinUnused = -1;

// How a bank's pins move its targets (#636).
enum class BankDrive : uint8_t {
  // One pin, held at the shown or hidden level for as long as the state lasts.
  kLevel,
  // Two pins, each pulsed: `gpio` sets a latching relay to shown, `hide_gpio`
  // resets it to hidden. Between pulses both rest at the inactive level.
  kLatching,
};

constexpr int32_t kDefaultPulseMs = 100;
constexpr int32_t kMinPulseMs = 10;
constexpr int32_t kMaxPulseMs = 1000;

// One independently driven target group: its pins, one polarity, one name.
struct TargetBank {
  // The level-driven pin, or a latching bank's show pin.
  int32_t gpio = 0;
  // Which level is active: for a level bank, the one that shows it; for a
  // latching bank, the pulse level. Per bank rather than per device because the
  // de-energised state of each bank's wiring is what has to be its resting
  // state (D-31, D-41).
  bool active_low = true;
  // Display only. It lives in the hardware configuration and never in a
  // program, so renaming a bank cannot re-aim one.
  std::string name;
  BankDrive drive = BankDrive::kLevel;
  // Latching only. A level bank carries both but only range-checks them, like
  // a pin of a peripheral the build does not have.
  int32_t hide_gpio = kPinUnused;
  int32_t pulse_ms = kDefaultPulseMs;
};

inline bool operator==(const TargetBank &a, const TargetBank &b) {
  return a.gpio == b.gpio && a.active_low == b.active_low && a.name == b.name &&
         a.drive == b.drive && a.hide_gpio == b.hide_gpio && a.pulse_ms == b.pulse_ms;
}
inline bool operator!=(const TargetBank &a, const TargetBank &b) {
  return !(a == b);
}

// Whether two bank lists differ in a way a restart would change - the pins, the
// polarity, the drive and the pulse length, which `targets::init()` latches. `name` is display only
// and nothing latches it, so renaming a bank must not report `restartRequired`.
bool same_wiring(const std::vector<TargetBank> &a, const std::vector<TargetBank> &b);

// A..H. A firmware constant rather than a contract limit; raising it later is
// additive (D-41).
constexpr size_t kMaxTargetBanks = 8;

// Long enough for "Vänster" or "Bana 3", short enough to fit a run-page cell.
constexpr size_t kMaxBankNameLength = 16;

// Bank masks are one bit per bank, bit 0 being bank A.
using BankMask = uint32_t;

// Every bank, whatever the device's count. Bits above the count are ignored,
// so one constant works on a one-bank device and an eight-bank one.
constexpr BankMask kAllBanksMask = 0xFFFFFFFFu;

inline BankMask bank_bit(size_t index) {
  return static_cast<BankMask>(1u) << index;
}

// The letter a bank is addressed by. '?' outside the range rather than running
// off the alphabet - a diagnostic that reads as wrong beats one that reads as
// bank 'I'.
inline char bank_letter(size_t index) {
  return index < kMaxTargetBanks ? static_cast<char>('A' + index) : '?';
}

// Every bank a device with `count` of them has.
inline BankMask mask_for_count(size_t count) {
  return count >= 32 ? kAllBanksMask : (static_cast<BankMask>(1u) << count) - 1u;
}

// What a `{"banks": [...]}` body asked for. `ok` false means nothing may move:
// the list is applied whole, so a typo cannot half-work.
struct BankSelection {
  BankMask mask = 0;
  bool ok = false;
  // The entry that failed, verbatim, so the refusal can quote what was typed
  // rather than what it was hoped to be. Empty when the list itself was.
  std::string offender;
};

// Letters to a mask, against a device that has `bank_count` banks. Upper case
// only, one letter per entry; a duplicate is accepted, since naming a bank
// twice asks for nothing a single mention does not.
//
// An empty list is refused rather than widened to every bank: "omitted" is what
// means every bank, and a client that sent an empty array asked for something
// else.
BankSelection parse_bank_selection(const std::vector<std::string> &letters, size_t bank_count);

// Why a selection was refused, for a problem document's `detail`.
std::string bank_refusal_message(const BankSelection &selection, size_t bank_count);

// The `message` for a /targets/* success: what moved and which way. `shown` and
// `hidden` are the banks driven each way, so a toggle that split them says so.
//
// Every bank going the same way keeps the pre-bank wording exactly - a one-bank
// device never sees a letter.
std::string targets_moved_message(BankMask shown, BankMask hidden, size_t bank_count);

}  // namespace rt
