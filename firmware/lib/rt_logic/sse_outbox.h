// ============================================================================
//  rt_logic/sse_outbox.h
//  The /sse/v2 frames waiting for the httpd task, and when to wake it.
//
//  httpd_queue_work's mailbox drops a message silently when full (#427), so the
//  frames wait here and the mailbox carries only "drain" messages: at most one
//  per batch, plus one beat at a time.
// ============================================================================
#pragma once

#include <algorithm>
#include <cstddef>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace rt {

class SseOutbox {
 public:
  struct Frame {
    const char *event;  // static string literal
    std::string payload;
  };

  enum class Delivery {
    // The frame carries the whole of something - the run state, the config
    // window, the liveness a heartbeat shows - so a newer one supersedes a
    // pending one for the same event. Never refused, so the last state before
    // a busy spell always goes out.
    kLatest,
    // A one-off notification: each one counts, and a full outbox refuses it.
    kEach,
  };

  enum class Push {
    kPostDrain,  // queued; the caller must post a drain message
    kQueued,     // queued behind a drain already posted
    kDropped,    // refused: `capacity` kEach frames are already waiting
  };

  // `capacity` bounds the kEach frames, and 0 refuses them all. kLatest frames
  // are bounded by the number of distinct events that use it.
  explicit SseOutbox(size_t capacity) : capacity_(capacity) {}

  Push push(const char *event, std::string payload, Delivery delivery) {
    if (delivery == Delivery::kLatest) {
      // Removed and re-appended rather than replaced in place, so the frame
      // still goes out after everything raised before it.
      frames_.erase(std::remove_if(frames_.begin(), frames_.end(),
                                   [&](const Entry &e) {
                                     return e.latest && std::strcmp(e.frame.event, event) == 0;
                                   }),
                    frames_.end());
    } else if (each_count() >= capacity_) {
      return Push::kDropped;
    }
    frames_.push_back({{event, std::move(payload)}, delivery == Delivery::kLatest});
    if (drain_posted_) return Push::kQueued;
    drain_posted_ = true;
    return Push::kPostDrain;
  }

  // Everything pending, oldest first, and the outbox empty again: the next
  // push posts a fresh drain.
  //
  // A drain the mailbox lost leaves `drain_posted_` set, and nothing pushed
  // after it would post another. The beat message is what recovers that: it
  // drains too, so a lost drain costs at most one beat.
  std::vector<Frame> take() {
    std::vector<Frame> out;
    out.reserve(frames_.size());
    for (Entry &e : frames_) out.push_back(std::move(e.frame));
    frames_.clear();
    drain_posted_ = false;
    return out;
  }

  // The drain push() asked for could not be posted at all, so the next push
  // asks again rather than waiting for a beat.
  void drain_not_posted() { drain_posted_ = false; }

  // Beats posted while one still waits only pile up in the mailbox, where they
  // crowd out httpd's own close requests. After this many, the waiting one is
  // taken to be lost and posted again.
  static constexpr int kBeatRepostAfter = 6;

  // The heartbeat timer fired: whether to post a beat message.
  bool beat() {
    if (beat_waiting_ && ++beat_waits_ < kBeatRepostAfter) return false;
    beat_waiting_ = true;
    beat_waits_ = 0;
    return true;
  }

  // A beat message ran. False for a re-posted duplicate of one that already
  // ran, which must drain but not reap: rt::SseClients::overdue() counts beats.
  bool beat_ran() {
    const bool first = beat_waiting_;
    beat_waiting_ = false;
    return first;
  }

  // The beat beat() asked for could not be posted at all: nothing waits.
  void beat_not_posted() { beat_waiting_ = false; }

 private:
  struct Entry {
    Frame frame;
    bool latest;
  };

  size_t each_count() const {
    return static_cast<size_t>(
        std::count_if(frames_.begin(), frames_.end(), [](const Entry &e) { return !e.latest; }));
  }

  size_t capacity_;
  std::vector<Entry> frames_;
  bool drain_posted_ = false;
  bool beat_waiting_ = false;
  int beat_waits_ = 0;
};

}  // namespace rt
