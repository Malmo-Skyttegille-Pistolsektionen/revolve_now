# Vendored from hoeken/PsychicHttp (MIT), src/ + LICENSE only (examples/ and
# its Arduino/ArduinoJson/esp_littlefs submodules are not needed - we're
# always the pure-ESP-IDF path, no Arduino component in this project).
#
# Verbatim apart from four local patches (marked "Local patch" in place), to go
# upstream:
# - a peer FIN mid-body made httpd_req_recv() return 0, which the body readers
#   never counted, so they looped forever and the TWDT panicked the device.
#   loadBody also reported ESP_OK after a failed read.
# - MultipartProcessor frees a file part's buffer at its closing boundary, and
#   a byte after the boundary that is neither '-' nor '\r' then re-emitted the
#   delimiter into that freed (NULL) buffer. It is a parse error now.
# - the body readers retried a recv timeout forever, so a peer that sent
#   headers and then nothing held the only httpd task indefinitely. A body now
#   has to keep up a minimum average rate after a grace period
#   (PSYCHIC_BODY_GRACE_MS in PsychicCore.h).
# - nothing limited how many parameters a request could carry, and each is a
#   heap object, so a form body of '&' cost ~70 bytes of heap per byte sent.
#   Past PSYCHIC_MAX_PARAMS (PsychicCore.h) further parameters are dropped.
file(GLOB PSYCHIC_HTTP_SRCS "src/*.cpp")

idf_component_register(
    SRCS ${PSYCHIC_HTTP_SRCS}
    INCLUDE_DIRS "src"
    REQUIRES esp_https_server esp_http_server esp_netif esp_timer mbedtls arduinojson
)

target_compile_definitions(${COMPONENT_LIB} PUBLIC -DESP32)
target_compile_options(${COMPONENT_LIB} PRIVATE -fno-rtti)
