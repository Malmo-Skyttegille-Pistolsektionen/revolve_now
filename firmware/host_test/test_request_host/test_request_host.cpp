// ============================================================================
//  Host and Origin checks against DNS rebinding and cross-site writes. Most of
//  these are about what must NOT pass: a name that merely contains the
//  device's, or an origin that differs only in port.
// ============================================================================
#include "request_host.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

void test_host_name_drops_port_and_trailing_dot_and_case() {
  TEST_ASSERT_EQUAL_STRING("revolve-now.local", rt::host_name("Revolve-Now.local.:8080").c_str());
  TEST_ASSERT_EQUAL_STRING("192.168.1.5", rt::host_name("192.168.1.5:80").c_str());
  TEST_ASSERT_EQUAL_STRING("[fe80::1]", rt::host_name("[FE80::1]:8080").c_str());
}

void test_the_devices_own_names_are_allowed() {
  TEST_ASSERT_TRUE(rt::host_allowed("revolve-now.local", "revolve-now"));
  TEST_ASSERT_TRUE(rt::host_allowed("REVOLVE-NOW.LOCAL:80", "revolve-now"));
  TEST_ASSERT_TRUE(rt::host_allowed("revolve-now", "revolve-now"));
  TEST_ASSERT_TRUE(rt::host_allowed("revolve-now.local.", "revolve-now"));
}

void test_ip_literals_and_localhost_are_allowed() {
  TEST_ASSERT_TRUE(rt::host_allowed("192.168.1.5", "revolve-now"));
  TEST_ASSERT_TRUE(rt::host_allowed("10.0.2.15:8080", "revolve-now"));
  TEST_ASSERT_TRUE(rt::host_allowed("[fe80::1]:80", "revolve-now"));
  TEST_ASSERT_TRUE(rt::host_allowed("localhost:8080", "revolve-now"));
}

// The rebinding case: the attacker's own name in Host.
void test_a_foreign_name_is_refused() {
  TEST_ASSERT_FALSE(rt::host_allowed("attacker.example", "revolve-now"));
  TEST_ASSERT_FALSE(rt::host_allowed("rebind.invalid:80", "revolve-now"));
}

// An attacker chooses their own subdomains, so containing the device's name
// proves nothing.
void test_a_name_built_around_the_devices_is_refused() {
  TEST_ASSERT_FALSE(rt::host_allowed("revolve-now.attacker.example", "revolve-now"));
  TEST_ASSERT_FALSE(rt::host_allowed("revolve-now.local.attacker.example", "revolve-now"));
  TEST_ASSERT_FALSE(rt::host_allowed("x-revolve-now.local", "revolve-now"));
}

// Looks numeric, but is a name an attacker can register.
void test_a_name_that_only_resembles_an_address_is_refused() {
  TEST_ASSERT_FALSE(rt::host_allowed("192.168.1.5.attacker.example", "revolve-now"));
  TEST_ASSERT_FALSE(rt::host_allowed("1.2.3", "revolve-now"));
  TEST_ASSERT_FALSE(rt::host_allowed("1.2.3.4.5", "revolve-now"));
  TEST_ASSERT_FALSE(rt::host_allowed("1.2.3.256", "revolve-now"));
  TEST_ASSERT_FALSE(rt::host_allowed("1.2.3.0004", "revolve-now"));
}

void test_an_absent_host_is_allowed() {
  TEST_ASSERT_TRUE(rt::host_allowed("", "revolve-now"));
}

void test_a_host_that_is_only_a_port_is_refused() {
  TEST_ASSERT_FALSE(rt::host_allowed(":80", "revolve-now"));
  TEST_ASSERT_FALSE(rt::host_allowed(".", "revolve-now"));
}

void test_same_origin_matches_scheme_and_authority() {
  TEST_ASSERT_TRUE(rt::same_origin("http://localhost:8080", "localhost:8080"));
  TEST_ASSERT_TRUE(rt::same_origin("http://Revolve-Now.local", "revolve-now.local"));
  TEST_ASSERT_TRUE(rt::same_origin("https://10.0.0.2", "10.0.0.2"));
}

void test_a_different_port_or_name_is_not_same_origin() {
  TEST_ASSERT_FALSE(rt::same_origin("http://localhost:5173", "localhost:8080"));
  TEST_ASSERT_FALSE(rt::same_origin("http://attacker.example", "revolve-now.local"));
  TEST_ASSERT_FALSE(rt::same_origin("null", "revolve-now.local"));
  TEST_ASSERT_FALSE(rt::same_origin("http://revolve-now.local", ""));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_host_name_drops_port_and_trailing_dot_and_case);
  RUN_TEST(test_the_devices_own_names_are_allowed);
  RUN_TEST(test_ip_literals_and_localhost_are_allowed);
  RUN_TEST(test_a_foreign_name_is_refused);
  RUN_TEST(test_a_name_built_around_the_devices_is_refused);
  RUN_TEST(test_a_name_that_only_resembles_an_address_is_refused);
  RUN_TEST(test_an_absent_host_is_allowed);
  RUN_TEST(test_a_host_that_is_only_a_port_is_refused);
  RUN_TEST(test_same_origin_matches_scheme_and_authority);
  RUN_TEST(test_a_different_port_or_name_is_not_same_origin);
  return UNITY_END();
}
