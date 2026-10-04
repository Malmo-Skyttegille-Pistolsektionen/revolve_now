# A patched fork of Espressif's
# examples/protocols/http_server/captive_portal/components/dns_server, taken
# from ESP-IDF v6.0.2 (SPDX: Unlicense OR CC0-1.0). Answers every DNS A query
# so any device connecting to the AP is redirected into the captive portal.
#
# Not byte-identical to upstream: both files are clang-formatted, and
# dns_server.c carries these functional changes, each commented in place:
# - a graceful stop: SO_RCVTIMEO, `volatile` started/task, and
#   stop_dns_server() waiting for the task to exit rather than vTaskDelete()-ing
#   it inside recvfrom(), which left the lwIP core lock held;
# - an_count is the number of answers written, not of questions asked, so a
#   skipped AAAA or unmatched query is no longer reported as answered (worth
#   upstreaming);
# - no close() on the receive-error path, which reached the shared close() too;
# - per-query logging raised from ESP_LOGD to ESP_LOGI.
idf_component_register(SRCS dns_server.c
                       INCLUDE_DIRS include
                       PRIV_REQUIRES esp_netif)
