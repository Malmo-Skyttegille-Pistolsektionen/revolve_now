// ============================================================================
//  parse_decimal_u31 and trim_space: the shared halves of the URI, filename
//  and console id parsers and of the two trims.
// ============================================================================
#include <cstdint>
#include <string>

#include "text_parse.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

void test_decimal_digits_parse() {
  int32_t out = -1;
  TEST_ASSERT_TRUE(rt::parse_decimal_u31("0", out));
  TEST_ASSERT_EQUAL_INT32(0, out);
  TEST_ASSERT_TRUE(rt::parse_decimal_u31("1000", out));
  TEST_ASSERT_EQUAL_INT32(1000, out);
  TEST_ASSERT_TRUE(rt::parse_decimal_u31("007", out));
  TEST_ASSERT_EQUAL_INT32(7, out);
  TEST_ASSERT_TRUE(rt::parse_decimal_u31("2147483647", out));
  TEST_ASSERT_EQUAL_INT32(INT32_MAX, out);
}

void test_anything_but_the_whole_text_as_digits_is_refused_and_leaves_out_alone() {
  for (const char *text : {"", "+1", "-1", " 1", "1 ", "1a", "0x10", "1.0", "2147483648",
                           "4294967296", "99999999999999999999"}) {
    int32_t out = 42;
    TEST_ASSERT_FALSE_MESSAGE(rt::parse_decimal_u31(text, out), text);
    TEST_ASSERT_EQUAL_INT32_MESSAGE(42, out, text);
  }
}

void test_a_digit_after_an_embedded_nul_is_not_read_past() {
  // A string_view carries its own length, so the NUL is an ordinary non-digit.
  int32_t out = 42;
  TEST_ASSERT_FALSE(rt::parse_decimal_u31(std::string_view("1\0002", 3), out));
}

void test_trim_space_removes_ascii_whitespace_at_both_ends_only() {
  TEST_ASSERT_EQUAL_STRING("a b", std::string(rt::trim_space(" \t\r\n\v\fa b\f\v\n\r\t ")).c_str());
  TEST_ASSERT_EQUAL_STRING("abc", std::string(rt::trim_space("abc")).c_str());
  TEST_ASSERT_TRUE(rt::trim_space("").empty());
  TEST_ASSERT_TRUE(rt::trim_space(" \t ").empty());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_decimal_digits_parse);
  RUN_TEST(test_anything_but_the_whole_text_as_digits_is_refused_and_leaves_out_alone);
  RUN_TEST(test_a_digit_after_an_embedded_nul_is_not_read_past);
  RUN_TEST(test_trim_space_removes_ascii_whitespace_at_both_ends_only);
  return UNITY_END();
}
