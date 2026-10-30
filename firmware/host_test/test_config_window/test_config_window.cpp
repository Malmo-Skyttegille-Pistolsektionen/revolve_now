// ============================================================================
//  Three presses of BOOT open the configuration window for one client (#656).
//  What matters is that another client on the network can never end up holding
//  a window the operator opened.
// ============================================================================
#include "config_window.h"
#include "unity.h"

namespace {

// Distinct tokens on every call; the tests assert binding, not entropy.
uint8_t s_counter = 0;
void counting_bytes(uint8_t *out, size_t len) {
  ++s_counter;
  for (size_t i = 0; i < len; i++) out[i] = static_cast<uint8_t>(s_counter + i);
}

using State = rt::ConfigWindow::State;
using Press = rt::ConfigWindow::Press;

}  // namespace

void setUp() {
  s_counter = 0;
}
void tearDown() {}

void test_a_request_then_the_presses_open_the_window_for_that_token_only() {
  rt::ConfigWindow window(counting_bytes);
  const std::string token = window.request("", 1000);
  TEST_ASSERT_EQUAL(32, token.size());
  TEST_ASSERT_TRUE(window.state(token, 1000) == State::kPending);
  TEST_ASSERT_FALSE(window.holds(token, 1000));

  TEST_ASSERT_TRUE(window.press(5000) == Press::kGranted);
  TEST_ASSERT_TRUE(window.holds(token, 5000));
  TEST_ASSERT_TRUE(window.state(token, 5000) == State::kOpen);
  TEST_ASSERT_FALSE(window.holds("", 5000));
  TEST_ASSERT_FALSE(window.holds("0123456789abcdef0123456789abcdef", 5000));
}

// The finding (#656): a client that was not at the board, polling for the
// window, must not be able to use one the operator opened.
void test_another_client_sees_the_window_elsewhere_and_cannot_use_it() {
  rt::ConfigWindow window(counting_bytes);
  const std::string mine = window.request("", 1000);
  window.press(2000);
  TEST_ASSERT_TRUE(window.state("", 2000) == State::kElsewhere);
  TEST_ASSERT_TRUE(window.state("ffffffffffffffffffffffffffffffff", 2000) == State::kElsewhere);
  TEST_ASSERT_TRUE(window.holds(mine, 2000));
}

void test_presses_with_nothing_requested_open_nothing() {
  rt::ConfigWindow window(counting_bytes);
  TEST_ASSERT_TRUE(window.press(1000) == Press::kNothingPending);
  TEST_ASSERT_FALSE(window.open(1000));
  TEST_ASSERT_TRUE(window.state("", 1000) == State::kClosed);
}

// The race #642 closed for the setup portal: somebody polling with requests
// of their own around the operator's turns the press into a conflict.
void test_a_poller_alongside_the_operator_turns_the_press_into_a_conflict() {
  rt::ConfigWindow window(counting_bytes);
  std::string attacker = window.request("", 0);
  int64_t t = 0;
  for (; t < 10'000; t += 250) attacker = window.request(attacker, t);
  const std::string operator_token = window.request("", t);
  for (; t < 12'000; t += 250) attacker = window.request(attacker, t);

  TEST_ASSERT_TRUE(window.press(t) == Press::kConflict);
  TEST_ASSERT_FALSE(window.open(t));
  TEST_ASSERT_FALSE(window.holds(attacker, t));
  TEST_ASSERT_FALSE(window.holds(operator_token, t));
  TEST_ASSERT_TRUE(window.state(operator_token, t) == State::kConflict);
  TEST_ASSERT_TRUE(window.state(attacker, t) == State::kConflict);
}

// A client re-asking without its token is a second request too - otherwise a
// poller could simply drop the token and look like one client.
void test_two_tokenless_requests_are_two_requests() {
  rt::ConfigWindow window(counting_bytes);
  const std::string a = window.request("", 1000);
  const std::string b = window.request("", 1000);
  TEST_ASSERT_FALSE(a == b);
  TEST_ASSERT_TRUE(window.press(2000) == Press::kConflict);
}

void test_asking_again_with_the_token_is_the_same_request() {
  rt::ConfigWindow window(counting_bytes);
  const std::string token = window.request("", 1000);
  TEST_ASSERT_EQUAL_STRING(token.c_str(), window.request(token, 2000).c_str());
  TEST_ASSERT_TRUE(window.press(3000) == Press::kGranted);
  TEST_ASSERT_TRUE(window.holds(token, 3000));
}

// A conflict is resolved by asking again, not by pressing again.
void test_a_conflict_clears_every_request() {
  rt::ConfigWindow window(counting_bytes);
  window.request("", 1000);
  window.request("", 1000);
  TEST_ASSERT_TRUE(window.press(2000) == Press::kConflict);
  TEST_ASSERT_TRUE(window.press(3000) == Press::kNothingPending);

  const std::string again = window.request("", 4000);
  TEST_ASSERT_TRUE(window.press(5000) == Press::kGranted);
  TEST_ASSERT_TRUE(window.holds(again, 5000));
}

void test_a_conflict_is_reported_for_a_while_then_forgotten() {
  rt::ConfigWindow window(counting_bytes);
  const std::string a = window.request("", 0);
  window.request("", 0);
  window.press(1000);
  TEST_ASSERT_TRUE(window.state(a, 1000 + rt::kWindowConflictMs - 1) == State::kConflict);
  TEST_ASSERT_TRUE(window.state(a, 1000 + rt::kWindowConflictMs) == State::kClosed);
}

void test_a_request_lapses_if_nobody_presses() {
  rt::ConfigWindow window(counting_bytes);
  const std::string token = window.request("", 0);
  int64_t left = 0;
  TEST_ASSERT_TRUE(window.state(token, 1000, &left) == State::kPending);
  TEST_ASSERT_EQUAL_INT64(rt::kWindowRequestMs - 1000, left);
  TEST_ASSERT_TRUE(window.state(token, rt::kWindowRequestMs) == State::kClosed);
  TEST_ASSERT_TRUE(window.press(rt::kWindowRequestMs) == Press::kNothingPending);
}

// A stale request does not make a fresh one a conflict.
void test_a_lapsed_request_does_not_conflict_with_a_new_one() {
  rt::ConfigWindow window(counting_bytes);
  window.request("", 0);
  const std::string fresh = window.request("", rt::kWindowRequestMs + 1);
  TEST_ASSERT_TRUE(window.press(rt::kWindowRequestMs + 2) == Press::kGranted);
  TEST_ASSERT_TRUE(window.holds(fresh, rt::kWindowRequestMs + 2));
}

void test_the_window_lasts_five_minutes() {
  rt::ConfigWindow window(counting_bytes);
  const std::string token = window.request("", 0);
  window.press(1000);
  int64_t left = 0;
  TEST_ASSERT_TRUE(window.state(token, 1000, &left) == State::kOpen);
  TEST_ASSERT_EQUAL_INT64(rt::kConfigWindowMs, left);
  TEST_ASSERT_TRUE(window.holds(token, 1000 + rt::kConfigWindowMs - 1));
  TEST_ASSERT_FALSE(window.holds(token, 1000 + rt::kConfigWindowMs));
  TEST_ASSERT_FALSE(window.open(1000 + rt::kConfigWindowMs));
  TEST_ASSERT_TRUE(window.state(token, 1000 + rt::kConfigWindowMs) == State::kClosed);
}

// The holder asks again and presses again for a fresh five minutes, keeping
// its token - and keeping the window open while it waits.
void test_the_holder_can_renew_with_the_same_token() {
  rt::ConfigWindow window(counting_bytes);
  const std::string token = window.request("", 0);
  window.press(1000);
  TEST_ASSERT_EQUAL_STRING(token.c_str(), window.request(token, 200'000).c_str());
  TEST_ASSERT_TRUE(window.holds(token, 200'000));
  TEST_ASSERT_TRUE(window.state(token, 200'000) == State::kOpen);
  const int64_t before = window.until_ms();
  TEST_ASSERT_TRUE(window.press(201'000) == Press::kGranted);
  TEST_ASSERT_TRUE(window.until_ms() > before);
  TEST_ASSERT_TRUE(window.holds(token, 201'000 + rt::kConfigWindowMs - 1));
}

// A conflict opens nothing, and takes nothing away either.
void test_a_conflict_leaves_an_open_window_with_its_holder() {
  rt::ConfigWindow window(counting_bytes);
  const std::string holder = window.request("", 0);
  window.press(1000);
  window.request("", 2000);
  window.request("", 2000);
  TEST_ASSERT_TRUE(window.press(3000) == Press::kConflict);
  TEST_ASSERT_TRUE(window.holds(holder, 3000));
}

// A grant to somebody else ends the previous holder's window: there is one.
void test_a_new_grant_replaces_the_holder() {
  rt::ConfigWindow window(counting_bytes);
  const std::string first = window.request("", 0);
  window.press(1000);
  const std::string second = window.request("", 2000);
  window.press(3000);
  TEST_ASSERT_TRUE(window.holds(second, 3000));
  TEST_ASSERT_FALSE(window.holds(first, 3000));
  TEST_ASSERT_TRUE(window.state(first, 3000) == State::kElsewhere);
}

// Refused rather than evicting: evicting the oldest would let a flood push the
// operator's request out and leave the flooder's as the only one.
void test_a_full_queue_refuses_and_the_press_still_conflicts() {
  rt::ConfigWindow window(counting_bytes);
  const std::string operator_token = window.request("", 0);
  for (size_t i = 1; i < rt::kMaxWindowRequests; i++) {
    TEST_ASSERT_FALSE(window.request("", 0).empty());
  }
  TEST_ASSERT_TRUE(window.request("", 0).empty());
  TEST_ASSERT_TRUE(window.state(operator_token, 0) == State::kPending);
  TEST_ASSERT_TRUE(window.press(1000) == Press::kConflict);
}

// Asking with a token already pending is never refused for being full.
void test_a_waiting_client_can_ask_again_when_the_queue_is_full() {
  rt::ConfigWindow window(counting_bytes);
  const std::string first = window.request("", 0);
  for (size_t i = 1; i < rt::kMaxWindowRequests; i++) window.request("", 0);
  TEST_ASSERT_EQUAL_STRING(first.c_str(), window.request(first, 100).c_str());
}

void test_an_empty_token_never_holds_anything() {
  rt::ConfigWindow window(counting_bytes);
  TEST_ASSERT_FALSE(window.holds("", 0));
  window.request("", 0);
  window.press(1000);
  TEST_ASSERT_FALSE(window.holds("", 1000));
  TEST_ASSERT_TRUE(window.state("", 1000) == State::kElsewhere);
}

void test_reset_shuts_everything() {
  rt::ConfigWindow window(counting_bytes);
  const std::string token = window.request("", 0);
  window.press(1000);
  window.reset();
  TEST_ASSERT_FALSE(window.open(1000));
  TEST_ASSERT_TRUE(window.state(token, 1000) == State::kClosed);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_request_then_the_presses_open_the_window_for_that_token_only);
  RUN_TEST(test_another_client_sees_the_window_elsewhere_and_cannot_use_it);
  RUN_TEST(test_presses_with_nothing_requested_open_nothing);
  RUN_TEST(test_a_poller_alongside_the_operator_turns_the_press_into_a_conflict);
  RUN_TEST(test_two_tokenless_requests_are_two_requests);
  RUN_TEST(test_asking_again_with_the_token_is_the_same_request);
  RUN_TEST(test_a_conflict_clears_every_request);
  RUN_TEST(test_a_conflict_is_reported_for_a_while_then_forgotten);
  RUN_TEST(test_a_request_lapses_if_nobody_presses);
  RUN_TEST(test_a_lapsed_request_does_not_conflict_with_a_new_one);
  RUN_TEST(test_the_window_lasts_five_minutes);
  RUN_TEST(test_the_holder_can_renew_with_the_same_token);
  RUN_TEST(test_a_conflict_leaves_an_open_window_with_its_holder);
  RUN_TEST(test_a_new_grant_replaces_the_holder);
  RUN_TEST(test_a_full_queue_refuses_and_the_press_still_conflicts);
  RUN_TEST(test_a_waiting_client_can_ask_again_when_the_queue_is_full);
  RUN_TEST(test_an_empty_token_never_holds_anything);
  RUN_TEST(test_reset_shuts_everything);
  return UNITY_END();
}
