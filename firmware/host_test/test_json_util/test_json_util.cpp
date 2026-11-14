// ============================================================================
//  json_quote and json_message. json_quote is what stands between an uploaded
//  title and an SSE `data:` line, where a raw newline would split the frame.
// ============================================================================
#include <string>

#include "json_util.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

namespace {

struct Case {
  const char *name;
  std::string in;
  const char *quoted;
};

}  // namespace

void test_json_quote_escapes_exactly_what_json_requires() {
  const Case cases[] = {
      {"empty", "", R"("")"},
      {"plain", "Snabbmatch 10s", R"("Snabbmatch 10s")"},
      {"quote", "a\"b", R"("a\"b")"},
      {"backslash", "a\\b", R"("a\\b")"},
      {"newline", "a\nb", R"("a\nb")"},
      {"carriage return", "a\rb", R"("a\rb")"},
      {"tab", "a\tb", R"("a\tb")"},
      {"backspace", "a\bb", R"("a\bb")"},
      {"form feed", "a\fb", R"("a\fb")"},
      // No short escape exists for the rest of C0, so they take the \u form.
      {"NUL", std::string("a\0b", 3), R"("a\u0000b")"},
      {"unit separator", "a\037b", R"("a\u001fb")"},
      // DEL is not a control character to JSON and passes through raw.
      {"DEL", "a\177b", "\"a\177b\""},
      // Every byte of a multi-byte sequence is >= 0x80, so none is escaped.
      {"UTF-8", "F\xc3\xa4ltskytte \xe2\x82\xac", "\"F\xc3\xa4ltskytte \xe2\x82\xac\""},
      {"slash is not escaped", "a/b", R"("a/b")"},
  };
  for (const Case &c : cases) {
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c.quoted, rt::json_quote(c.in).c_str(), c.name);
  }
}

void test_json_message_wraps_a_quoted_message() {
  TEST_ASSERT_EQUAL_STRING(R"({"message":"Program loaded"})",
                           rt::json_message("Program loaded").c_str());
  TEST_ASSERT_EQUAL_STRING(R"({"message":"a\"b\nc"})", rt::json_message("a\"b\nc").c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_json_quote_escapes_exactly_what_json_requires);
  RUN_TEST(test_json_message_wraps_a_quoted_message);
  return UNITY_END();
}
