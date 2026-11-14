// ============================================================================
//  The setup portal's BOOT press commits one unambiguous submission (#208).
//  What matters is that a second party on the setup AP can never have its own
//  credentials committed by the operator's press.
// ============================================================================
#include "setup_claim.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

namespace {

const rt::WifiCredentials kOperator{"ClubWifi", "operator-pw"};
const rt::WifiCredentials kAttacker{"EvilTwin", "attackerpw"};

}  // namespace

void test_a_submission_then_a_press_commits_it() {
  rt::SetupClaim claim;
  claim.submit(kOperator, 1000);
  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(5000, out) == rt::SetupClaim::Outcome::kCommit);
  TEST_ASSERT_EQUAL_STRING("ClubWifi", out.ssid.c_str());
  TEST_ASSERT_EQUAL_STRING("operator-pw", out.password.c_str());
}

void test_a_press_with_nothing_submitted_commits_nothing() {
  rt::SetupClaim claim;
  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(1000, out) == rt::SetupClaim::Outcome::kNothingPending);
  TEST_ASSERT_TRUE(out.ssid.empty());
}

// The attack this exists for: somebody else on the setup AP polls /save with
// their own network, every 250 ms, before and after the operator submits.
void test_a_poller_alongside_the_operator_turns_the_press_into_a_conflict() {
  rt::SetupClaim claim;
  int64_t t = 0;
  for (; t < 10'000; t += 250) claim.submit(kAttacker, t);
  claim.submit(kOperator, t);
  for (; t < 12'000; t += 250) claim.submit(kAttacker, t);

  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(t, out) == rt::SetupClaim::Outcome::kConflict);
  TEST_ASSERT_TRUE(out.ssid.empty());
}

// Even when the operator's submission arrived first.
void test_a_later_different_submission_is_a_conflict() {
  rt::SetupClaim claim;
  claim.submit(kOperator, 1000);
  claim.submit(kAttacker, 1250);
  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(2000, out) == rt::SetupClaim::Outcome::kConflict);
}

void test_the_same_submission_twice_is_not_a_conflict() {
  rt::SetupClaim claim;
  claim.submit(kOperator, 1000);
  claim.submit(kOperator, 1300);
  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(2000, out) == rt::SetupClaim::Outcome::kCommit);
}

// A different password for the same network is a different submission.
void test_the_same_ssid_with_another_password_is_a_conflict() {
  rt::SetupClaim claim;
  claim.submit(kOperator, 1000);
  claim.submit({"ClubWifi", "other"}, 1300);
  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(2000, out) == rt::SetupClaim::Outcome::kConflict);
}

void test_a_press_clears_the_claim() {
  rt::SetupClaim claim;
  claim.submit(kOperator, 1000);
  rt::WifiCredentials out;
  claim.press(2000, out);
  TEST_ASSERT_FALSE(claim.pending(2001));
  TEST_ASSERT_TRUE(claim.press(2500, out) == rt::SetupClaim::Outcome::kNothingPending);
}

// After a conflict the operator submits again; the old conflict does not
// follow the new submission.
void test_a_conflict_is_cleared_by_the_press() {
  rt::SetupClaim claim;
  claim.submit(kOperator, 1000);
  claim.submit(kAttacker, 1100);
  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(2000, out) == rt::SetupClaim::Outcome::kConflict);
  claim.submit(kOperator, 3000);
  TEST_ASSERT_TRUE(claim.press(4000, out) == rt::SetupClaim::Outcome::kCommit);
  TEST_ASSERT_EQUAL_STRING("ClubWifi", out.ssid.c_str());
}

void test_the_claim_window_edge_is_inclusive() {
  rt::SetupClaim claim;
  claim.submit(kOperator, 1000);
  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(1000 + rt::kSetupClaimMs, out) == rt::SetupClaim::Outcome::kCommit);
}

void test_a_submission_nobody_pressed_for_expires() {
  rt::SetupClaim claim;
  claim.submit(kOperator, 1000);
  TEST_ASSERT_TRUE(claim.pending(1000 + rt::kSetupClaimMs));
  TEST_ASSERT_FALSE(claim.pending(1001 + rt::kSetupClaimMs));
  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(2000 + rt::kSetupClaimMs, out) ==
                   rt::SetupClaim::Outcome::kNothingPending);
}

// An expired submission does not linger as the other half of a conflict.
void test_a_submission_after_expiry_starts_afresh() {
  rt::SetupClaim claim;
  claim.submit(kAttacker, 0);
  claim.submit(kOperator, rt::kSetupClaimMs + 1);
  rt::WifiCredentials out;
  TEST_ASSERT_TRUE(claim.press(rt::kSetupClaimMs + 2, out) == rt::SetupClaim::Outcome::kCommit);
  TEST_ASSERT_EQUAL_STRING("ClubWifi", out.ssid.c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_submission_then_a_press_commits_it);
  RUN_TEST(test_a_press_with_nothing_submitted_commits_nothing);
  RUN_TEST(test_a_poller_alongside_the_operator_turns_the_press_into_a_conflict);
  RUN_TEST(test_a_later_different_submission_is_a_conflict);
  RUN_TEST(test_the_same_submission_twice_is_not_a_conflict);
  RUN_TEST(test_the_same_ssid_with_another_password_is_a_conflict);
  RUN_TEST(test_a_press_clears_the_claim);
  RUN_TEST(test_a_conflict_is_cleared_by_the_press);
  RUN_TEST(test_the_claim_window_edge_is_inclusive);
  RUN_TEST(test_a_submission_nobody_pressed_for_expires);
  RUN_TEST(test_a_submission_after_expiry_starts_afresh);
  return UNITY_END();
}
