// ============================================================================
//  rt_logic/control_lock.h
//  The control lock - host-testable.
//  Ported from src/backend/repositories/admin_mode.py.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <string_view>

namespace rt {

constexpr size_t kTokenBytes = 16;

// Fills `out` with `kTokenBytes` cryptographically random bytes. The firmware
// backs this with esp_fill_random(); host tests substitute a counter, since
// what the tests assert is token *distinctness* and lifecycle, not entropy.
using RandomBytesFn = void (*)(uint8_t *out, size_t len);

// Monotonic milliseconds, for token expiry. Injected for the same reason the
// executor's clock is: so the host tests can age a token out without sleeping.
using NowMsFn = int64_t (*)();

// Stretches a password with a salt into `out_len` bytes. The firmware backs
// this with PBKDF2-HMAC-SHA256; host tests substitute something cheap, since
// what they assert is that the right password matches and a wrong one does
// not, not the strength of the hash.
using DeriveKeyFn = void (*)(const std::string &password, const uint8_t *salt, size_t salt_len,
                             uint8_t *out, size_t out_len);

constexpr size_t kSaltBytes = 16;
constexpr size_t kKeyBytes = 32;
// What persists: salt then derived key, never the password.
constexpr size_t kVerifierBytes = kSaltBytes + kKeyBytes;

// A session lasts a shooting session, not a boot. Without this a token
// captured from the non-HttpOnly cookie stayed valid for the device's entire
// uptime, and the only revocation was disable() - which drops the device to
// the *unprotected* state rather than a safer one.
constexpr int64_t kTokenTtlMs = 12LL * 60 * 60 * 1000;

// Concurrent sessions. A client that re-logs-in on every page load would
// otherwise grow the set for the life of the boot; oldest is evicted first.
constexpr size_t kMaxTokens = 8;

// Compares without an early exit, so the time taken does not depend on how
// many leading bytes matched. The password is the realistic target: it is
// human-chosen and /control-lock/login can be probed without limit.
inline bool constant_time_equals(const std::string &a, const std::string &b) {
  // Length is not secret - it leaks through the response size anyway - but the
  // walk below must still be over a fixed range for the compared bytes.
  if (a.size() != b.size()) return false;

  unsigned char diff = 0;
  for (size_t i = 0; i < a.size(); i++) {
    diff |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
  }
  return diff == 0;
}

// `kTokenBytes` random bytes, hex-encoded: the control lock's session tokens
// and the configuration window's (rt::ConfigWindow) alike.
inline std::string random_token(RandomBytesFn random_bytes) {
  uint8_t raw[kTokenBytes];
  random_bytes(raw, sizeof(raw));

  static const char *kHex = "0123456789abcdef";
  std::string token;
  token.reserve(kTokenBytes * 2);
  for (uint8_t b : raw) {
    token += kHex[b >> 4];
    token += kHex[b & 0x0f];
  }
  return token;
}

// The control lock is off until a client turns it on with a password of its
// own choosing; while it is on, mutating endpoints require a session token.
//
// The password survives a reboot as a verifier (D-51): a salted, stretched
// hash the caller persists and restore()s at boot. Sessions do not - after a
// restart the lock is still on and everyone logs in again. Before D-51 nothing
// persisted, so any crash returned the device to the unprotected state.
//
// It gates *changing* the device, never *looking at* it. That sentence is the
// whole reason this is no longer called "admin mode": the old name read as a
// privilege tier, and a read was put behind it once on the strength of that
// (#256, #257, D-39).
class ControlLock {
 public:
  ControlLock(RandomBytesFn random_bytes, NowMsFn now_ms, DeriveKeyFn derive_key)
      : random_bytes_(random_bytes), now_ms_(now_ms), derive_key_(derive_key) {}

  // enable() refuses an empty password, so a verifier is what "on" means.
  bool enabled() const { return !verifier_.empty(); }

  // Turn the lock on and return a session token, or empty if refused
  // (already on, or an empty password).
  std::string enable(const std::string &password) {
    if (enabled() || password.empty()) return {};
    uint8_t salt[kSaltBytes];
    random_bytes_(salt, sizeof(salt));
    verifier_.assign(reinterpret_cast<const char *>(salt), sizeof(salt));
    verifier_ += derive(password, salt);
    return issue_token();
  }

  // Return a session token for the active password, or empty if refused.
  std::string login(const std::string &password) {
    if (!enabled()) return {};
    const auto *salt = reinterpret_cast<const uint8_t *>(verifier_.data());
    if (!constant_time_equals(derive(password, salt), verifier_.substr(kSaltBytes))) return {};
    return issue_token();
  }

  void disable() {
    verifier_.clear();
    tokens_.clear();
  }

  // What to persist while the lock is on; empty while it is off.
  const std::string &verifier() const { return verifier_; }

  // Turns the lock back on from a persisted verifier, with no sessions. False,
  // leaving the lock as it was, for anything that is not one.
  bool restore(const std::string &verifier) {
    if (verifier.size() != kVerifierBytes) return false;
    verifier_ = verifier;
    tokens_.clear();
    return true;
  }

  // Invalidates one token without turning the lock off - the safe half of
  // "log out", which disable() is not.
  bool logout(const std::string &token) {
    for (auto it = tokens_.begin(); it != tokens_.end(); ++it) {
      if (constant_time_equals(it->value, token)) {
        tokens_.erase(it);
        return true;
      }
    }
    return false;
  }

  // Whether a request carrying these credentials may call a protected
  // endpoint. While the lock is off everything is allowed - the endpoints
  // are only protected once a client turns protection on.
  bool authorize(const std::string &authorization_header,
                 const std::string &control_lock_cookie) const {
    if (!enabled()) return true;

    if (is_valid_token(bearer_token(authorization_header))) return true;
    return is_valid_token(control_lock_cookie);
  }

  // The bearer token from an `Authorization` header, or empty.
  static std::string bearer_token(const std::string &header) {
    constexpr std::string_view kBearer = "Bearer ";
    if (header.size() <= kBearer.size()) return {};
    if (header.compare(0, kBearer.size(), kBearer) != 0) return {};
    return header.substr(kBearer.size());
  }

 private:
  struct Token {
    std::string value;
    int64_t issued_ms = 0;
  };

  bool is_valid_token(const std::string &token) const {
    if (token.empty()) return false;

    const int64_t now = now_ms_();
    bool found = false;
    // Every token is compared, and each comparison is constant-time: an early
    // `break` on a match would leak how far down the list the hit was.
    for (const Token &candidate : tokens_) {
      if (constant_time_equals(candidate.value, token) && now - candidate.issued_ms < kTokenTtlMs) {
        found = true;
      }
    }
    return found;
  }

  std::string derive(const std::string &password, const uint8_t *salt) const {
    uint8_t key[kKeyBytes];
    derive_key_(password, salt, kSaltBytes, key, sizeof(key));
    return std::string(reinterpret_cast<const char *>(key), sizeof(key));
  }

  std::string issue_token() {
    std::string token = random_token(random_bytes_);
    if (tokens_.size() >= kMaxTokens) tokens_.pop_front();
    tokens_.push_back(Token{token, now_ms_()});
    return token;
  }

  RandomBytesFn random_bytes_;
  NowMsFn now_ms_;
  DeriveKeyFn derive_key_;
  std::string verifier_;
  std::deque<Token> tokens_;
};

}  // namespace rt
