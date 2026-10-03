// ============================================================================
//  rt_logic/sse_outbox.h
//  The /sse/v2 frames waiting for the httpd task, and when to wake it.
//
//  The firmware reaches the httpd task through httpd_queue_work, whose queue is
//  a loopback UDP mailbox of six datagrams. A full one drops a message without
//  telling the sender (#427), so one message per frame lost frames silently
//  whenever the task was busy - an OTA upload, say - and leaked each one. Here
//  the frames wait in a buffer of our own instead, and the mailbox carries only
//  a "drain" message: at most one per batch, plus one per heartbeat.
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

  // `capacity` bounds the kEach frames. kLatest frames are bounded by the
  // number of distinct events that use it.
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
  // after it would post another. The heartbeat is what recovers that: it posts
  // a drain on every beat regardless, so a lost one costs at most one beat.
  std::vector<Frame> take() {
    std::vector<Frame> out;
    out.reserve(frames_.size());
    for (Entry &e : frames_) out.push_back(std::move(e.frame));
    frames_.clear();
    drain_posted_ = false;
    return out;
  }

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
};

}  // namespace rt
