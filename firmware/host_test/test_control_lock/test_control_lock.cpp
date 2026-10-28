// ============================================================================
//  The control lock: enable/login/disable, what authorizes a request, and the
//  verifier that carries it across a reboot.
//  Ported from tests/unit/repositories/test_admin_mode.py.
// ============================================================================
#include "control_lock.h"
#include "unity.h"

namespace {

// A counter, not real entropy: these tests assert token distinctness and
// lifecycle, and a deterministic sequence makes a failure reproducible. The
// firmware injects esp_fill_random() instead.
uint32_t g_counter = 0;

void counting_bytes(uint8_t *out, size_t len) {
  g_counter++;
  for (size_t i = 0; i < len; i++) out[i] = static_cast<uint8_t>(g_counter + i);
}

// Advanced by hand so token expiry is asserted without sleeping.
int64_t g_now_ms = 1'000'000;
int64_t fake_now() {
  return g_now_ms;
}

// Not a real KDF: the tests assert that the right password matches and a wrong
// one does not, and that the salt takes part. The firmware injects PBKDF2.
void fake_derive(const std::string &password, const uint8_t *salt, size_t salt_len, uint8_t *out,
                 size_t out_len) {
  for (size_t i = 0; i < out_len; i++) {
    const uint8_t p = password.empty() ? 0 : static_cast<uint8_t>(password[i % password.size()]);
    out[i] = static_cast<uint8_t>(p ^ salt[i % salt_len] ^ (i * 31));
  }
}

rt::ControlLock *lock = nullptr;

rt::ControlLock &mode() {
  return *lock;
}

}  // namespace

void setUp() {
  g_counter = 0;
  g_now_ms = 1'000'000;
  lock = new rt::ControlLock(counting_bytes, fake_now, fake_derive);
}

void tearDown() {
  delete lock;
  lock = nullptr;
}

// --- enable ----------------------------------------------------------------

void test_starts_disabled() {
  TEST_ASSERT_FALSE(mode().enabled());
}

void test_enable_returns_a_token() {
  const std::string token = mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().enabled());
  TEST_ASSERT_FALSE(token.empty());
  // 16 random bytes, hex-encoded.
  TEST_ASSERT_EQUAL_size_t(32, token.size());
}

void test_enable_rejects_an_empty_password() {
  TEST_ASSERT_TRUE(mode().enable("").empty());
  TEST_ASSERT_FALSE(mode().enabled());
}

void test_enable_is_refused_while_enabled() {
  mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().enable("other").empty());
}

// --- login -----------------------------------------------------------------

void test_login_is_refused_while_disabled() {
  TEST_ASSERT_TRUE(mode().login("hunter2").empty());
}

void test_login_rejects_the_wrong_password() {
  mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().login("wrong").empty());
}

void test_login_issues_a_second_token_without_invalidating_the_first() {
  const std::string first = mode().enable("hunter2");
  const std::string second = mode().login("hunter2");

  TEST_ASSERT_FALSE(second.empty());
  TEST_ASSERT_FALSE(first == second);
  TEST_ASSERT_TRUE(mode().authorize("Bearer " + first, ""));
  TEST_ASSERT_TRUE(mode().authorize("Bearer " + second, ""));
}

// --- authorize -------------------------------------------------------------

void test_everything_is_allowed_while_disabled() {
  TEST_ASSERT_TRUE(mode().authorize("", ""));
}

void test_a_bearer_token_is_accepted() {
  const std::string token = mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().authorize("Bearer " + token, ""));
}

void test_the_cookie_is_accepted() {
  const std::string token = mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().authorize("", token));
}

void test_missing_credentials_are_rejected() {
  mode().enable("hunter2");

  TEST_ASSERT_FALSE(mode().authorize("", ""));
}

void test_an_unknown_token_is_rejected() {
  mode().enable("hunter2");

  TEST_ASSERT_FALSE(mode().authorize("Bearer nope", ""));
  TEST_ASSERT_FALSE(mode().authorize("", "nope"));
}

void test_a_bare_token_without_the_bearer_prefix_is_rejected() {
  const std::string token = mode().enable("hunter2");

  TEST_ASSERT_FALSE(mode().authorize(token, ""));
}

void test_disable_invalidates_issued_tokens() {
  const std::string token = mode().enable("hunter2");

  mode().disable();
  mode().enable("hunter2");

  TEST_ASSERT_FALSE(mode().authorize("Bearer " + token, ""));
}

// --- expiry, capacity, logout ----------------------------------------------

void test_a_token_expires() {
  const std::string token = mode().enable("hunter2");
  TEST_ASSERT_TRUE(mode().authorize("Bearer " + token, ""));

  g_now_ms += rt::kTokenTtlMs - 1;
  TEST_ASSERT_TRUE(mode().authorize("Bearer " + token, ""));

  g_now_ms += 2;
  TEST_ASSERT_FALSE(mode().authorize("Bearer " + token, ""));
}

void test_an_expired_token_does_not_disable_control_lock() {
  // Expiry must not fall open - the endpoints stay protected.
  mode().enable("hunter2");
  g_now_ms += rt::kTokenTtlMs + 1;

  TEST_ASSERT_TRUE(mode().enabled());
  TEST_ASSERT_FALSE(mode().authorize("", ""));
}

void test_the_token_store_is_capped_oldest_first() {
  const std::string first = mode().enable("hunter2");
  for (size_t i = 0; i < rt::kMaxTokens; i++) mode().login("hunter2");

  // kMaxTokens logins after the enable push the original out.
  TEST_ASSERT_FALSE(mode().authorize("Bearer " + first, ""));

  const std::string newest = mode().login("hunter2");
  TEST_ASSERT_TRUE(mode().authorize("Bearer " + newest, ""));
}

void test_logout_invalidates_only_that_token() {
  const std::string a = mode().enable("hunter2");
  const std::string b = mode().login("hunter2");

  TEST_ASSERT_TRUE(mode().logout(a));

  TEST_ASSERT_FALSE(mode().authorize("Bearer " + a, ""));
  TEST_ASSERT_TRUE(mode().authorize("Bearer " + b, ""));
  // Still on, unlike disable(), which would drop to the unprotected state.
  TEST_ASSERT_TRUE(mode().enabled());
}

void test_logout_of_an_unknown_token_is_refused() {
  mode().enable("hunter2");
  TEST_ASSERT_FALSE(mode().logout("nope"));
}

void test_constant_time_equals_matches_normal_comparison() {
  TEST_ASSERT_TRUE(rt::constant_time_equals("", ""));
  TEST_ASSERT_TRUE(rt::constant_time_equals("abc", "abc"));
  TEST_ASSERT_FALSE(rt::constant_time_equals("abc", "abd"));
  TEST_ASSERT_FALSE(rt::constant_time_equals("abc", "ab"));
  TEST_ASSERT_FALSE(rt::constant_time_equals("", "a"));
}

void test_a_malformed_authorization_header_is_refused() {
  const std::string token = mode().enable("hunter2");

  TEST_ASSERT_FALSE(mode().authorize("Bearer", ""));
  TEST_ASSERT_FALSE(mode().authorize("Bearer ", ""));
  TEST_ASSERT_FALSE(mode().authorize("bearer " + token, ""));
  TEST_ASSERT_FALSE(mode().authorize("Basic " + token, ""));
}

// --- persistence (D-51) -----------------------------------------------------

void test_the_verifier_is_empty_while_off() {
  TEST_ASSERT_TRUE(mode().verifier().empty());
}

void test_the_verifier_does_not_contain_the_password() {
  mode().enable("hunter2-hunter2");
  const std::string &v = mode().verifier();
  TEST_ASSERT_EQUAL_size_t(rt::kVerifierBytes, v.size());
  TEST_ASSERT_TRUE(v.find("hunter2") == std::string::npos);
}

// The whole point: a reboot is a fresh ControlLock restored from what the old
// one persisted.
void test_a_restored_lock_is_on_and_takes_the_same_password() {
  mode().enable("hunter2");
  const std::string persisted = mode().verifier();

  rt::ControlLock rebooted(counting_bytes, fake_now, fake_derive);
  TEST_ASSERT_TRUE(rebooted.restore(persisted));
  TEST_ASSERT_TRUE(rebooted.enabled());
  TEST_ASSERT_TRUE(rebooted.login("wrong").empty());
  TEST_ASSERT_FALSE(rebooted.login("hunter2").empty());
}

// Sessions are RAM-only: a token from before the reboot is not honoured.
void test_a_restored_lock_has_no_sessions() {
  const std::string token = mode().enable("hunter2");
  rt::ControlLock rebooted(counting_bytes, fake_now, fake_derive);
  rebooted.restore(mode().verifier());
  TEST_ASSERT_FALSE(rebooted.authorize("Bearer " + token, ""));
  TEST_ASSERT_FALSE(rebooted.authorize("", ""));
}

void test_a_malformed_verifier_is_refused_and_leaves_the_lock_off() {
  TEST_ASSERT_FALSE(mode().restore(""));
  TEST_ASSERT_FALSE(mode().restore(std::string(rt::kVerifierBytes - 1, 'x')));
  TEST_ASSERT_FALSE(mode().restore(std::string(rt::kVerifierBytes + 1, 'x')));
  TEST_ASSERT_FALSE(mode().enabled());
}

// Each enable draws a fresh salt, so the same password does not give the same
// verifier twice.
void test_the_same_password_gives_a_different_verifier_each_time() {
  mode().enable("hunter2");
  const std::string first = mode().verifier();
  mode().disable();
  mode().enable("hunter2");
  TEST_ASSERT_FALSE(first == mode().verifier());
}

void test_disable_clears_the_verifier() {
  mode().enable("hunter2");
  mode().disable();
  TEST_ASSERT_TRUE(mode().verifier().empty());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_starts_disabled);
  RUN_TEST(test_enable_returns_a_token);
  RUN_TEST(test_enable_rejects_an_empty_password);
  RUN_TEST(test_enable_is_refused_while_enabled);

  RUN_TEST(test_login_is_refused_while_disabled);
  RUN_TEST(test_login_rejects_the_wrong_password);
  RUN_TEST(test_login_issues_a_second_token_without_invalidating_the_first);

  RUN_TEST(test_everything_is_allowed_while_disabled);
  RUN_TEST(test_a_bearer_token_is_accepted);
  RUN_TEST(test_the_cookie_is_accepted);
  RUN_TEST(test_missing_credentials_are_rejected);
  RUN_TEST(test_an_unknown_token_is_rejected);
  RUN_TEST(test_a_bare_token_without_the_bearer_prefix_is_rejected);
  RUN_TEST(test_disable_invalidates_issued_tokens);

  RUN_TEST(test_a_token_expires);
  RUN_TEST(test_an_expired_token_does_not_disable_control_lock);
  RUN_TEST(test_the_token_store_is_capped_oldest_first);
  RUN_TEST(test_logout_invalidates_only_that_token);
  RUN_TEST(test_logout_of_an_unknown_token_is_refused);
  RUN_TEST(test_constant_time_equals_matches_normal_comparison);
  RUN_TEST(test_a_malformed_authorization_header_is_refused);
  RUN_TEST(test_the_verifier_is_empty_while_off);
  RUN_TEST(test_the_verifier_does_not_contain_the_password);
  RUN_TEST(test_a_restored_lock_is_on_and_takes_the_same_password);
  RUN_TEST(test_a_restored_lock_has_no_sessions);
  RUN_TEST(test_a_malformed_verifier_is_refused_and_leaves_the_lock_off);
  RUN_TEST(test_the_same_password_gives_a_different_verifier_each_time);
  RUN_TEST(test_disable_clears_the_verifier);
  return UNITY_END();
}
