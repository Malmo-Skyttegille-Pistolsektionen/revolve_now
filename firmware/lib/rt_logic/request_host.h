// ============================================================================
//  rt_logic/request_host.h
//  Whether a request's Host and Origin headers belong to this device.
//  Host-testable, no ESP-IDF.
// ============================================================================
#pragma once

#include <cctype>
#include <string>
#include <string_view>

namespace rt {

namespace detail {

inline std::string lower(std::string_view s) {
  std::string out(s);
  for (char &c : out) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return out;
}

inline bool is_ipv4_literal(std::string_view s) {
  int parts = 0;
  size_t i = 0;
  while (i <= s.size()) {
    size_t digits = 0;
    int value = 0;
    while (i < s.size() && std::isdigit(static_cast<unsigned char>(s[i]))) {
      value = value * 10 + (s[i] - '0');
      if (++digits > 3) return false;
      i++;
    }
    if (digits == 0 || value > 255) return false;
    parts++;
    if (i == s.size()) break;
    if (s[i] != '.') return false;
    i++;
  }
  return parts == 4;
}

}  // namespace detail

// The name in a Host header, lowercased, without its port or a trailing dot:
// "Revolve-Now.local.:8080" is "revolve-now.local". An IPv6 literal keeps its
// brackets.
inline std::string host_name(std::string_view host) {
  if (!host.empty() && host.front() == '[') {
    const size_t close = host.find(']');
    return detail::lower(close == std::string_view::npos ? host : host.substr(0, close + 1));
  }
  const size_t colon = host.find(':');
  if (colon != std::string_view::npos) host = host.substr(0, colon);
  if (!host.empty() && host.back() == '.') host.remove_suffix(1);
  return detail::lower(host);
}

// Whether a Host header names this device.
//
// DNS rebinding is the reason: a page on an attacker's domain re-resolves that
// domain to the device and becomes same-origin with it, so CORS no longer
// applies. Its requests still carry the attacker's name in Host, which is what
// this refuses. An IP literal is always fine - a rebinding page cannot make
// the browser send one - and so are `localhost` (QEMU, the dev server) and
// the device's own names.
//
// An empty Host is allowed: no browser sends one.
inline bool host_allowed(std::string_view host_header, std::string_view hostname) {
  if (host_header.empty()) return true;
  const std::string name = host_name(host_header);
  if (name.empty()) return false;
  if (name.front() == '[' || detail::is_ipv4_literal(name)) return true;
  if (name == "localhost") return true;
  const std::string own = detail::lower(hostname);
  return !own.empty() && (name == own || name == own + ".local");
}

// Whether `origin` is the origin of a page served under `host_header`: the
// same scheme-less authority, as a browser writes both.
inline bool same_origin(std::string_view origin, std::string_view host_header) {
  if (host_header.empty()) return false;
  const std::string o = detail::lower(origin);
  const std::string h = detail::lower(host_header);
  return o == "http://" + h || o == "https://" + h;
}

}  // namespace rt
