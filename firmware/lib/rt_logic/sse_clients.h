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
  // Dropping loses nothing: every `stateUpdate` is the full state, and
  // EventSource reconnects into a fresh snapshot. A short write has also split
  // a frame, after which that stream cannot be continued anyway.
  template <typename Write>
  std::vector<int> send(const std::vector<int> &sockets, const std::string &frame, Write &&write) {
    std::vector<int> stalled;
    for (const int sock : sockets) {
      if (closing(sock)) continue;
      const long written = write(sock, frame.data(), frame.size());
      if (written < 0 || static_cast<size_t>(written) != frame.size()) {
        closing_.push_back(sock);
        stalled.push_back(sock);
      }
    }
    return stalled;
  }

  // The close has happened. Forgotten because the socket number will be
  // reused by the next connection.
  void closed(int sock) {
    closing_.erase(std::remove(closing_.begin(), closing_.end(), sock), closing_.end());
  }

  // Dropped, and not yet closed: the close goes through the httpd work queue,
  // and frames already queued ahead of it must not reach the split stream.
  bool closing(int sock) const {
    return std::find(closing_.begin(), closing_.end(), sock) != closing_.end();
  }

 private:
  std::vector<int> closing_;
};

}  // namespace rt
