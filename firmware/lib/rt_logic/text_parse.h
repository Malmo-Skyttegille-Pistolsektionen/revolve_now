// ============================================================================
//  rt_logic/text_parse.h
//  Small text-parsing helpers shared by the parsers that take outside input.
// ============================================================================
#pragma once

#include <charconv>
#include <cstdint>
#include <string_view>
#include <system_error>

namespace rt {

// The whole of `text` as a non-negative decimal int32: digits only - no sign,
// no whitespace, nothing after - and at most INT32_MAX. `out` is untouched on
// failure.
inline bool parse_decimal_u31(std::string_view text, int32_t &out) {
  uint32_t value = 0;
  const char *begin = text.data();
  const char *end = begin + text.size();
  const std::from_chars_result r = std::from_chars(begin, end, value);
  if (r.ec != std::errc() || r.ptr != end || value > static_cast<uint32_t>(INT32_MAX)) return false;
  out = static_cast<int32_t>(value);
  return true;
}

// `text` without leading or trailing ASCII whitespace (the C-locale isspace set).
inline std::string_view trim_space(std::string_view text) {
  constexpr std::string_view kSpace = " \t\n\v\f\r";
  const size_t first = text.find_first_not_of(kSpace);
  if (first == std::string_view::npos) return {};
  return text.substr(first, text.find_last_not_of(kSpace) - first + 1);
}

}  // namespace rt
