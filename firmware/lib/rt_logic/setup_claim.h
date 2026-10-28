// ============================================================================
//  rt_logic/setup_claim.h
//  Which setup-portal submission a BOOT press commits.
//  Host-testable, no GPIO and no ESP-IDF.
// ============================================================================
#pragma once

#include <cstdint>
#include <string>

namespace rt {

struct WifiCredentials {
  std::string ssid;
  std::string password;

  bool operator==(const WifiCredentials &other) const {
    return ssid == other.ssid && password == other.password;
  }
};

// How long a submission waits for its press.
constexpr int64_t kSetupClaimMs = 60'000;

// The press is the last step, and it commits only an unambiguous submission.
//
// It used to be the first step: a press set a device-wide flag, and whichever
// /save arrived next consumed it. The setup AP's password is public, so anyone
// in range could poll /save and take the operator's press for their own
// network. Now a submission waits here, and the press commits it only if no
// different submission arrived alongside it. Somebody polling with their own
// credentials turns the operator's press into a conflict, not a takeover.
//
// The same submission sent twice - a double tap on Save - is one submission.
class SetupClaim {
 public:
  enum class Outcome {
    kNothingPending,
    kCommit,
    kConflict,
  };

  void submit(const WifiCredentials &credentials, int64_t now_ms) {
    expire(now_ms);
    if (!pending_) {
      pending_ = true;
      since_ms_ = now_ms;
      credentials_ = credentials;
    } else if (!(credentials_ == credentials)) {
      conflict_ = true;
    }
  }

  // Always clears what was pending: a conflict is resolved by submitting
  // again, not by pressing again.
  Outcome press(int64_t now_ms, WifiCredentials &out) {
    expire(now_ms);
    Outcome outcome = Outcome::kNothingPending;
    if (pending_) outcome = conflict_ ? Outcome::kConflict : Outcome::kCommit;
    if (outcome == Outcome::kCommit) out = credentials_;
    clear();
    return outcome;
  }

  bool pending(int64_t now_ms) {
    expire(now_ms);
    return pending_;
  }

 private:
  void expire(int64_t now_ms) {
    if (pending_ && now_ms - since_ms_ > kSetupClaimMs) clear();
  }

  void clear() {
    pending_ = false;
    conflict_ = false;
    credentials_ = {};
  }

  bool pending_ = false;
  bool conflict_ = false;
  int64_t since_ms_ = 0;
  WifiCredentials credentials_;
};

}  // namespace rt
