// ============================================================================
//  rt::SseOutbox while the httpd task is busy: the frames wait here, the
//  mailbox sees one drain per batch, and the last state always goes out (#427).
// ============================================================================
#include <string>
#include <vector>

#include "sse_outbox.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

namespace {

using Delivery = rt::SseOutbox::Delivery;
using Push = rt::SseOutbox::Push;

std::string events(const std::vector<rt::SseOutbox::Frame> &frames) {
  std::string out;
  for (const auto &f : frames) out += std::string(f.event) + "=" + f.payload + " ";
  return out;
}

}  // namespace

void test_only_the_first_push_of_a_batch_posts_a_drain() {
  rt::SseOutbox outbox(4);
  TEST_ASSERT_TRUE(outbox.push("libraryChanged", "a", Delivery::kEach) == Push::kPostDrain);
  TEST_ASSERT_TRUE(outbox.push("libraryChanged", "b", Delivery::kEach) == Push::kQueued);
  TEST_ASSERT_TRUE(outbox.push("stateUpdate", "s", Delivery::kLatest) == Push::kQueued);
}

void test_take_returns_the_frames_in_order_and_rearms_the_drain() {
  rt::SseOutbox outbox(4);
  outbox.push("libraryChanged", "a", Delivery::kEach);
  outbox.push("stateUpdate", "s", Delivery::kLatest);

  TEST_ASSERT_EQUAL_STRING("libraryChanged=a stateUpdate=s ", events(outbox.take()).c_str());
  TEST_ASSERT_TRUE(outbox.take().empty());
  TEST_ASSERT_TRUE(outbox.push("libraryChanged", "b", Delivery::kEach) == Push::kPostDrain);
}

void test_a_newer_state_supersedes_the_pending_one() {
  rt::SseOutbox outbox(4);
  for (const char *s : {"1", "2", "3"}) outbox.push("stateUpdate", s, Delivery::kLatest);
  TEST_ASSERT_EQUAL_STRING("stateUpdate=3 ", events(outbox.take()).c_str());
}

void test_the_superseding_state_goes_after_what_was_raised_before_it() {
  rt::SseOutbox outbox(4);
  outbox.push("stateUpdate", "1", Delivery::kLatest);
  outbox.push("libraryChanged", "a", Delivery::kEach);
  outbox.push("stateUpdate", "2", Delivery::kLatest);
  TEST_ASSERT_EQUAL_STRING("libraryChanged=a stateUpdate=2 ", events(outbox.take()).c_str());
}

void test_latest_frames_supersede_per_event_only() {
  rt::SseOutbox outbox(4);
  outbox.push("stateUpdate", "1", Delivery::kLatest);
  outbox.push("heartbeat", "7", Delivery::kLatest);
  outbox.push("heartbeat", "8", Delivery::kLatest);
  TEST_ASSERT_EQUAL_STRING("stateUpdate=1 heartbeat=8 ", events(outbox.take()).c_str());
}

void test_a_full_outbox_refuses_one_off_frames() {
  rt::SseOutbox outbox(2);
  outbox.push("backend_issue", "a", Delivery::kEach);
  outbox.push("backend_issue", "b", Delivery::kEach);
  TEST_ASSERT_TRUE(outbox.push("backend_issue", "c", Delivery::kEach) == Push::kDropped);
  TEST_ASSERT_EQUAL_STRING("backend_issue=a backend_issue=b ", events(outbox.take()).c_str());
}

void test_a_full_outbox_still_takes_the_state() {
  // The loss #427 is about: the last stateUpdate before the task frees up.
  rt::SseOutbox outbox(1);
  outbox.push("backend_issue", "a", Delivery::kEach);
  TEST_ASSERT_TRUE(outbox.push("stateUpdate", "1", Delivery::kLatest) != Push::kDropped);
  TEST_ASSERT_TRUE(outbox.push("stateUpdate", "2", Delivery::kLatest) != Push::kDropped);
  TEST_ASSERT_EQUAL_STRING("backend_issue=a stateUpdate=2 ", events(outbox.take()).c_str());
}

void test_latest_frames_do_not_count_against_the_capacity() {
  rt::SseOutbox outbox(1);
  outbox.push("stateUpdate", "1", Delivery::kLatest);
  outbox.push("heartbeat", "1", Delivery::kLatest);
  TEST_ASSERT_TRUE(outbox.push("backend_issue", "a", Delivery::kEach) != Push::kDropped);
}

void test_a_lost_drain_is_recovered_by_the_next_take() {
  // The posted drain never ran: later pushes do not post another, and the
  // heartbeat's own drain picks everything up.
  rt::SseOutbox outbox(4);
  TEST_ASSERT_TRUE(outbox.push("stateUpdate", "1", Delivery::kLatest) == Push::kPostDrain);
  TEST_ASSERT_TRUE(outbox.push("stateUpdate", "2", Delivery::kLatest) == Push::kQueued);
  outbox.push("heartbeat", "1", Delivery::kLatest);

  TEST_ASSERT_EQUAL_STRING("stateUpdate=2 heartbeat=1 ", events(outbox.take()).c_str());
  TEST_ASSERT_TRUE(outbox.push("stateUpdate", "3", Delivery::kLatest) == Push::kPostDrain);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_only_the_first_push_of_a_batch_posts_a_drain);
  RUN_TEST(test_take_returns_the_frames_in_order_and_rearms_the_drain);
  RUN_TEST(test_a_newer_state_supersedes_the_pending_one);
  RUN_TEST(test_the_superseding_state_goes_after_what_was_raised_before_it);
  RUN_TEST(test_latest_frames_supersede_per_event_only);
  RUN_TEST(test_a_full_outbox_refuses_one_off_frames);
  RUN_TEST(test_a_full_outbox_still_takes_the_state);
  RUN_TEST(test_latest_frames_do_not_count_against_the_capacity);
  RUN_TEST(test_a_lost_drain_is_recovered_by_the_next_take);
  return UNITY_END();
}
