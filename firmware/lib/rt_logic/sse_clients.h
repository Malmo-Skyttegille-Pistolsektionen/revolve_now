// ============================================================================
//  rt_logic/sse_clients.h
//  The /sse/v2 fan-out policy: who gets a frame, and who is dropped instead.
//
//  The firmware writes with a non-blocking send on the httpd task, which is the
//  task that serves every REST request too. Any wait there - for a client that
//  has stopped reading - stops the whole web server (#343), so a client that
//  cannot take a frame at once is closed rather than waited for.
// ============================================================================
#pragma once

#include <algorithm>
#include <cstddef>
#include <string>
#include <vector>

namespace rt {

class SseClients {
 public:
  // Writes `frame` to every socket in `sockets` that is not already closing,
  // and returns the ones to close: each that took less than the whole frame.
  //
  // `write(sock, data, len)` must not block. It returns the bytes written, or
  // a negative value for anything else, would-block included.
  //
  // Run state survives the drop - every `stateUpdate` is the full state, and
  // the reconnect starts with one - but one-off events sent meanwhile do not.
  // A short write has also split a frame, so that stream cannot continue.
  template <typename Write>
  std::vector<int> send(const std::vector<int> &sockets, const std::string &frame, Write &&write) {
    std::vector<int> stalled;
    for (const int sock : sockets) {
      if (closing(sock)) continue;
      const long written = write(sock, frame.data(), frame.size());
      if (written < 0 || static_cast<size_t>(written) != frame.size()) {
        drop(sock);
        stalled.push_back(sock);
      }
    }
    return stalled;
  }

  // Marks `sock` as closing: it receives nothing more until closed().
  void drop(int sock) {
    if (!closing(sock)) closing_.push_back({sock, false});
  }

  // The close has happened. Forgotten because the socket number will be
  // reused by the next connection.
  void closed(int sock) {
    closing_.erase(std::remove_if(closing_.begin(), closing_.end(),
                                  [sock](const Entry &e) { return e.sock == sock; }),
                   closing_.end());
  }

  // Dropped, and not yet closed: the close goes through the httpd work queue,
  // and frames already queued ahead of it must not reach the split stream.
  bool closing(int sock) const {
    return std::any_of(closing_.begin(), closing_.end(),
                       [sock](const Entry &e) { return e.sock == sock; });
  }

  // The sockets still closing since the previous call, whose close must have
  // been lost: it travels the httpd work queue, which drops messages silently
  // when full (#427). Called once per heartbeat, so a pending close always gets
  // a full beat to land - a second close for the same session could otherwise
  // hit a new connection that has taken its slot.
  std::vector<int> overdue() {
    std::vector<int> late;
    for (Entry &e : closing_) {
      if (e.aged) late.push_back(e.sock);
      e.aged = true;
    }
    return late;
  }

 private:
  struct Entry {
    int sock;
    bool aged;
  };
  std::vector<Entry> closing_;
};

}  // namespace rt
