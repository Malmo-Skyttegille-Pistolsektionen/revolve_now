// ============================================================================
//  rt_logic/config_window.h
//  Which client three presses of BOOT open the configuration window for.
//  Host-testable, no GPIO and no ESP-IDF.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "control_lock.h"

namespace rt {

// How long an open window lasts. Long enough to type a pin number, short
// enough that a window nobody remembers opening is not still open.
constexpr int64_t kConfigWindowMs = 5LL * 60 * 1000;
// How long a request waits for its presses: time to walk to the board.
constexpr int64_t kWindowRequestMs = 2LL * 60 * 1000;
// How long a conflicted request keeps saying so, so its client can show why.
constexpr int64_t kWindowConflictMs = 2LL * 60 * 1000;
// Requests waiting at once. A press with more than one waiting is a conflict
// anyway, so this only bounds memory; past it a request is refused, never
// evicted - evicting would let a flood push the operator's request out (#656).
constexpr size_t kMaxWindowRequests = 4;

// The window belongs to one client, chosen by the press (D-52, #656).
//
// It used to be one device-wide deadline, so every client on the network could
// use a window the operator opened. Now a client asks first and gets an
// unguessable token; three presses then open the window for that token alone.
// The press is the last step, as in rt::SetupClaim: with more than one request
// waiting it opens the window for nobody, so somebody polling with their own
// requests turns the operator's press into a conflict, not a takeover.
//
// Asking again with the token already held is the same request, not a second.
class ConfigWindow {
 public:
  enum class State {
    kClosed,     // this token holds nothing, and no window is open
    kPending,    // waiting for the presses
    kOpen,       // holds the open window
    kConflict,   // its request was cleared by a press that found several
    kElsewhere,  // a window is open, for another token
  };

  enum class Press {
    kNothingPending,
    kGranted,
    kConflict,
  };

  explicit ConfigWindow(RandomBytesFn random_bytes) : random_bytes_(random_bytes) {}

  // The token to wait with: `presented` when it already names a request or
  // the open window, a new one otherwise. Empty when kMaxWindowRequests are
  // already waiting.
  std::string request(const std::string &presented, int64_t now_ms) {
    expire(now_ms);
    for (Request &r : pending_) {
      if (matches(r.token, presented)) {
        r.since_ms = now_ms;
        return r.token;
      }
    }
    std::string token;
    if (holds(presented, now_ms)) {
      token = holder_;  // asking for a fresh five minutes
    } else {
      token = random_token(random_bytes_);
    }
    if (pending_.size() >= kMaxWindowRequests) return {};
    pending_.push_back(Request{token, now_ms});
    return token;
  }

  // Three presses at the board. Always clears what was waiting: a conflict is
  // resolved by asking again, not by pressing again. A window already open
  // stays open through a conflict or a press with nothing waiting.
  Press press(int64_t now_ms) {
    expire(now_ms);
    if (pending_.empty()) return Press::kNothingPending;
    if (pending_.size() > 1) {
      conflicted_.clear();
      for (const Request &r : pending_) conflicted_.push_back(r.token);
      conflict_ms_ = now_ms;
      pending_.clear();
      return Press::kConflict;
    }
    holder_ = pending_.front().token;
    until_ms_ = now_ms + kConfigWindowMs;
    pending_.clear();
    return Press::kGranted;
  }

  // Whether `token` holds the open window.
  bool holds(const std::string &token, int64_t now_ms) const {
    return open(now_ms) && matches(holder_, token);
  }

  // Whether a window is open for anybody - what the SSE event says.
  bool open(int64_t now_ms) const { return !holder_.empty() && now_ms < until_ms_; }

  int64_t remaining_ms(int64_t now_ms) const { return open(now_ms) ? until_ms_ - now_ms : 0; }

  // The deadline, 0 when no window has been opened. Changes on every grant,
  // including a re-grant to the same token.
  int64_t until_ms() const { return until_ms_; }

  // What `token` should be told, and for how many more milliseconds it holds.
  State state(const std::string &token, int64_t now_ms, int64_t *remaining = nullptr) const {
    int64_t left = 0;
    State out = State::kClosed;
    if (holds(token, now_ms)) {
      out = State::kOpen;
      left = until_ms_ - now_ms;
    } else if (const Request *r = find_pending(token, now_ms)) {
      out = State::kPending;
      left = r->since_ms + kWindowRequestMs - now_ms;
    } else if (conflicted(token, now_ms)) {
      out = State::kConflict;
    } else if (open(now_ms)) {
      out = State::kElsewhere;
    }
    if (remaining != nullptr) *remaining = left;
    return out;
  }

  // Shuts the window and forgets every request. For tests and a future
  // "close now"; the device otherwise lets the window lapse.
  void reset() {
    pending_.clear();
    conflicted_.clear();
    holder_.clear();
    until_ms_ = 0;
  }

 private:
  struct Request {
    std::string token;
    int64_t since_ms = 0;
  };

  // Empty never matches: a client with no token must not match an empty slot.
  static bool matches(const std::string &stored, const std::string &presented) {
    return !presented.empty() && constant_time_equals(stored, presented);
  }

  void expire(int64_t now_ms) {
    for (auto it = pending_.begin(); it != pending_.end();) {
      it = now_ms - it->since_ms >= kWindowRequestMs ? pending_.erase(it) : it + 1;
    }
  }

  const Request *find_pending(const std::string &token, int64_t now_ms) const {
    for (const Request &r : pending_) {
      if (matches(r.token, token) && now_ms - r.since_ms < kWindowRequestMs) return &r;
    }
    return nullptr;
  }

  bool conflicted(const std::string &token, int64_t now_ms) const {
    if (now_ms - conflict_ms_ >= kWindowConflictMs) return false;
    bool found = false;
    for (const std::string &t : conflicted_) found = matches(t, token) || found;
    return found;
  }

  RandomBytesFn random_bytes_;
  std::vector<Request> pending_;
  std::vector<std::string> conflicted_;
  int64_t conflict_ms_ = 0;
  std::string holder_;
  int64_t until_ms_ = 0;
};

}  // namespace rt
