// ============================================================================
//  The /sse/v2 fan-out with one client that has stopped reading (#343).
//  On hardware such a client wedged the httpd task: the vendored send retried
//  a full socket forever, and REST stopped answering along with SSE. What
//  matters here is that the healthy clients keep receiving every frame, and
//  the stalled one is dropped on the first frame it cannot take.
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

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_every_client_gets_the_frame);
  RUN_TEST(test_a_full_socket_is_dropped_and_the_others_still_receive);
  RUN_TEST(test_a_short_write_is_dropped);
  RUN_TEST(test_a_client_that_stops_reading_is_dropped_once_and_not_written_again);
  RUN_TEST(test_a_reused_socket_number_receives_again_once_closed);
  return UNITY_END();
}
