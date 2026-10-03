// ============================================================================
//  rt::SseClients with a client that has stopped reading: the others keep
//  receiving every frame, and the stalled one is dropped once and only once.
// ============================================================================
#include <algorithm>
#include <map>
#include <string>
#include <vector>

#include "sse_clients.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

namespace {

// A socket per client: how many bytes it will still accept, and what it has
// received. A full socket answers would-block (-1) rather than waiting, which
// is the contract the firmware's MSG_DONTWAIT send keeps.
struct FakeSockets {
  std::map<int, long> room;
  std::map<int, std::string> received;
  int writes = 0;

  long operator()(int sock, const char *data, size_t len) {
    ++writes;
    const auto it = room.find(sock);
    const long space = it == room.end() ? 1L << 20 : it->second;
    if (space <= 0) return -1;
    const long n = std::min<long>(space, static_cast<long>(len));
    if (it != room.end()) it->second -= n;
    received[sock].append(data, static_cast<size_t>(n));
    return n;
  }
};

const std::string kFrame = "event: stateUpdate\r\ndata: {}\r\n\r\n";

}  // namespace

void test_every_client_gets_the_frame() {
  rt::SseClients clients;
  FakeSockets sockets;
  TEST_ASSERT_TRUE(clients.send({3, 4, 5}, kFrame, sockets).empty());
  for (int sock : {3, 4, 5})
    TEST_ASSERT_EQUAL_STRING(kFrame.c_str(), sockets.received[sock].c_str());
}

void test_a_full_socket_is_dropped_and_the_others_still_receive() {
  rt::SseClients clients;
  FakeSockets sockets;
  sockets.room[4] = 0;

  const std::vector<int> stalled = clients.send({3, 4, 5}, kFrame, sockets);

  TEST_ASSERT_EQUAL_UINT(1, stalled.size());
  TEST_ASSERT_EQUAL_INT(4, stalled[0]);
  TEST_ASSERT_TRUE(clients.closing(4));
  TEST_ASSERT_EQUAL_STRING(kFrame.c_str(), sockets.received[3].c_str());
  TEST_ASSERT_EQUAL_STRING(kFrame.c_str(), sockets.received[5].c_str());
}

void test_a_short_write_is_dropped() {
  // The stream already holds half a frame, so it cannot be continued.
  rt::SseClients clients;
  FakeSockets sockets;
  sockets.room[3] = 5;

  const std::vector<int> stalled = clients.send({3}, kFrame, sockets);

  TEST_ASSERT_EQUAL_UINT(1, stalled.size());
  TEST_ASSERT_EQUAL_INT(3, stalled[0]);
}

void test_a_client_that_stops_reading_is_dropped_once_and_not_written_again() {
  // The close is queued, so frames already queued ahead of it run first.
  rt::SseClients clients;
  FakeSockets sockets;
  sockets.room[4] = static_cast<long>(kFrame.size()) * 2;  // takes two frames, then fills

  int dropped = 0;
  for (int i = 0; i < 10; i++)
    dropped += static_cast<int>(clients.send({3, 4}, kFrame, sockets).size());

  TEST_ASSERT_EQUAL_INT(1, dropped);
  TEST_ASSERT_EQUAL_UINT(kFrame.size() * 10, sockets.received[3].size());
  TEST_ASSERT_EQUAL_UINT(kFrame.size() * 2, sockets.received[4].size());
  // Ten writes to the healthy client, three to the stalled one: two that fit
  // and the one that did not. Nothing after that.
  TEST_ASSERT_EQUAL_INT(13, sockets.writes);
}

void test_a_reused_socket_number_receives_again_once_closed() {
  rt::SseClients clients;
  FakeSockets sockets;
  sockets.room[4] = 0;
  clients.send({4}, kFrame, sockets);

  clients.closed(4);
  sockets.room.erase(4);  // the next connection on that number reads normally

  TEST_ASSERT_FALSE(clients.closing(4));
  TEST_ASSERT_TRUE(clients.send({4}, kFrame, sockets).empty());
  TEST_ASSERT_EQUAL_STRING(kFrame.c_str(), sockets.received[4].c_str());
}

void test_a_dropped_socket_is_skipped_without_a_write() {
  // What the reaper does to a peer that has gone: no frame goes to it either.
  rt::SseClients clients;
  FakeSockets sockets;
  clients.drop(4);

  TEST_ASSERT_TRUE(clients.send({3, 4}, kFrame, sockets).empty());
  TEST_ASSERT_EQUAL_INT(1, sockets.writes);
  TEST_ASSERT_EQUAL_UINT(0, sockets.received.count(4));
}

void test_a_close_is_overdue_only_after_a_full_beat() {
  // The first beat after a drop must not resend the close: it may still be
  // queued, and a second close for the session can hit a new connection.
  rt::SseClients clients;
  clients.drop(4);

  TEST_ASSERT_TRUE(clients.overdue().empty());
  const std::vector<int> late = clients.overdue();
  TEST_ASSERT_EQUAL_UINT(1, late.size());
  TEST_ASSERT_EQUAL_INT(4, late[0]);
  // And on every beat after that until the close lands.
  TEST_ASSERT_EQUAL_UINT(1, clients.overdue().size());
}

void test_a_close_that_landed_is_never_overdue() {
  rt::SseClients clients;
  clients.drop(4);
  clients.overdue();
  clients.closed(4);

  TEST_ASSERT_TRUE(clients.overdue().empty());
}

void test_dropping_twice_does_not_restart_the_clock() {
  rt::SseClients clients;
  clients.drop(4);
  clients.overdue();
  clients.drop(4);

  TEST_ASSERT_EQUAL_UINT(1, clients.overdue().size());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_every_client_gets_the_frame);
  RUN_TEST(test_a_full_socket_is_dropped_and_the_others_still_receive);
  RUN_TEST(test_a_short_write_is_dropped);
  RUN_TEST(test_a_client_that_stops_reading_is_dropped_once_and_not_written_again);
  RUN_TEST(test_a_reused_socket_number_receives_again_once_closed);
  RUN_TEST(test_a_dropped_socket_is_skipped_without_a_write);
  RUN_TEST(test_a_close_is_overdue_only_after_a_full_beat);
  RUN_TEST(test_a_close_that_landed_is_never_overdue);
  RUN_TEST(test_dropping_twice_does_not_restart_the_clock);
  return UNITY_END();
}
