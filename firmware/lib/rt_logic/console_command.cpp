#include "console_command.h"

#include <algorithm>
#include <cctype>

#include "text_parse.h"

namespace rt::console {
namespace {

char lower(char c) {
  return static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
}

// Everything after the first word, trimmed. Empty when there is nothing.
std::string_view tail(std::string_view text) {
  text = trim_space(text);
  const size_t end = text.find_first_of(" \t");
  return end == std::string_view::npos ? std::string_view{} : trim_space(text.substr(end));
}

std::string_view head(std::string_view text) {
  text = trim_space(text);
  const size_t end = text.find_first_of(" \t");
  return end == std::string_view::npos ? text : text.substr(0, end);
}

bool equals_ignoring_case(std::string_view a, std::string_view b) {
  return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin(),
                                            [](char x, char y) { return lower(x) == lower(y); });
}

}  // namespace

Command parse_command(std::string_view line) {
  const std::string_view word = head(line);
  if (word.empty()) return Command::kNone;
  if (equals_ignoring_case(word, "status")) return Command::kStatus;
  if (equals_ignoring_case(word, "help") || equals_ignoring_case(word, "?")) return Command::kHelp;
  if (equals_ignoring_case(word, "boot-targets")) return Command::kBootTargets;
  if (equals_ignoring_case(word, "wifi-scan")) return Command::kWifiScan;
  if (equals_ignoring_case(word, "wifi-info")) return Command::kWifiInfo;
  if (equals_ignoring_case(word, "eth-info")) return Command::kEthInfo;
  if (equals_ignoring_case(word, "factory-reset")) return Command::kFactoryReset;
  if (equals_ignoring_case(word, "play")) return Command::kPlay;
  return Command::kUnknown;
}

PlayArg parse_play(std::string_view line, int32_t &id) {
  const std::string_view argument = tail(line);
  if (argument.empty()) return PlayArg::kMissing;
  return parse_decimal_u31(argument, id) ? PlayArg::kId : PlayArg::kInvalid;
}

BootTargets parse_boot_targets(std::string_view line) {
  const std::string_view argument = tail(line);
  if (argument.empty()) return BootTargets::kMissing;
  if (equals_ignoring_case(argument, "shown")) return BootTargets::kShown;
  if (equals_ignoring_case(argument, "hidden")) return BootTargets::kHidden;
  return BootTargets::kInvalid;
}

bool factory_reset_confirmed(std::string_view line) {
  return equals_ignoring_case(tail(line), "confirm");
}

std::string first_word(std::string_view line) {
  return std::string(head(line));
}

}  // namespace rt::console
