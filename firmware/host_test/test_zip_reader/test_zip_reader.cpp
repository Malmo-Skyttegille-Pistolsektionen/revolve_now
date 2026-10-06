// ============================================================================
//  The forward-only ZIP reader behind POST /restore (#520).
//
//  Archives are made with ZipWriter, so a round trip is the claim being
//  tested: what the device writes, the device reads back. Every archive is
//  also fed one byte at a time and in every chunk size up to its length,
//  because the HTTP layer hands the body over in whatever pieces the socket
//  produced and a header split across two of them is the normal case.
// ============================================================================
#include <string>
#include <vector>

#include "unity.h"
#include "zip_reader.h"
#include "zip_writer.h"

namespace {

std::vector<uint8_t> g_archive;

bool collect(void *, const uint8_t *data, size_t len) {
  g_archive.insert(g_archive.end(), data, data + len);
  return true;
}

void add(rt::ZipWriter &zip, const std::string &name, const std::string &body) {
  const auto *bytes = reinterpret_cast<const uint8_t *>(body.data());
  TEST_ASSERT_TRUE(
      zip.begin(name, static_cast<uint32_t>(body.size()), rt::crc32(0, bytes, body.size())));
  TEST_ASSERT_TRUE(zip.write(bytes, body.size()));
}

std::vector<uint8_t> archive(const std::vector<std::pair<std::string, std::string>> &entries) {
  g_archive.clear();
  rt::ZipWriter zip(collect, nullptr);
  for (const auto &[name, body] : entries) add(zip, name, body);
  TEST_ASSERT_TRUE(zip.finish());
  return g_archive;
}

struct Seen {
  std::string name;
  uint32_t size = 0;
  std::string body;
  bool crc_ok = false;
  bool ended = false;
};

class Recorder : public rt::ZipReader::Visitor {
 public:
  std::vector<Seen> seen;
  // Stop at the start of this entry, for the caller that gives up.
  int stop_at = -1;

  bool on_entry(const rt::ZipReader::Entry &entry) override {
    if (static_cast<int>(seen.size()) == stop_at) return false;
    seen.push_back({entry.name, entry.size, "", false, false});
    return true;
  }
  bool on_data(const uint8_t *data, size_t len) override {
    seen.back().body.append(reinterpret_cast<const char *>(data), len);
    return true;
  }
  bool on_entry_end(bool crc_ok) override {
    seen.back().crc_ok = crc_ok;
    seen.back().ended = true;
    return true;
  }
};

bool feed_in_chunks(rt::ZipReader &reader, const std::vector<uint8_t> &bytes, size_t chunk) {
  for (size_t at = 0; at < bytes.size(); at += chunk) {
    const size_t len = std::min(chunk, bytes.size() - at);
    if (!reader.feed(bytes.data() + at, len)) return false;
  }
  return true;
}

const std::vector<std::pair<std::string, std::string>> kEntries = {
    {"manifest.json", "{\"format\":\"revolve-now-backup\"}"},
    {"empty.txt", ""},
    {"audio/1000.wav", std::string(300, '\x7f')},
    {"programs/1000.json", "{\"title\":\"P\"}"},
};

}  // namespace

void setUp() {}
void tearDown() {}

void test_every_entry_arrives_whole_in_any_chunking() {
  const std::vector<uint8_t> bytes = archive(kEntries);
  for (size_t chunk = 1; chunk <= bytes.size(); ++chunk) {
    Recorder recorder;
    rt::ZipReader reader(recorder);
    TEST_ASSERT_TRUE(feed_in_chunks(reader, bytes, chunk));
    TEST_ASSERT_TRUE_MESSAGE(reader.complete(), "did not reach the central directory");
    TEST_ASSERT_EQUAL_size_t(kEntries.size(), recorder.seen.size());
    for (size_t i = 0; i < kEntries.size(); ++i) {
      TEST_ASSERT_EQUAL_STRING(kEntries[i].first.c_str(), recorder.seen[i].name.c_str());
      TEST_ASSERT_EQUAL_UINT32(kEntries[i].second.size(), recorder.seen[i].size);
      TEST_ASSERT_TRUE(kEntries[i].second == recorder.seen[i].body);
      TEST_ASSERT_TRUE(recorder.seen[i].crc_ok);
      TEST_ASSERT_TRUE(recorder.seen[i].ended);
    }
  }
}

void test_an_empty_archive_is_complete_with_no_entries() {
  const std::vector<uint8_t> bytes = archive({});
  Recorder recorder;
  rt::ZipReader reader(recorder);
  TEST_ASSERT_TRUE(reader.feed(bytes.data(), bytes.size()));
  TEST_ASSERT_TRUE(reader.complete());
  TEST_ASSERT_EQUAL_size_t(0, reader.entries());
}

void test_a_flipped_payload_byte_fails_only_that_entrys_crc() {
  std::vector<uint8_t> bytes = archive({{"a.txt", "hello"}, {"b.txt", "world"}});
  bytes[30 + 5] ^= 0x01;  // first byte of a.txt's payload, past header and name
  Recorder recorder;
  rt::ZipReader reader(recorder);
  TEST_ASSERT_TRUE(reader.feed(bytes.data(), bytes.size()));
  TEST_ASSERT_TRUE(reader.complete());
  TEST_ASSERT_FALSE(recorder.seen[0].crc_ok);
  TEST_ASSERT_TRUE(recorder.seen[1].crc_ok);
}

void test_a_truncated_archive_is_not_complete() {
  std::vector<uint8_t> bytes = archive(kEntries);
  bytes.resize(bytes.size() / 2);
  Recorder recorder;
  rt::ZipReader reader(recorder);
  TEST_ASSERT_TRUE(reader.feed(bytes.data(), bytes.size()));
  TEST_ASSERT_FALSE(reader.complete());
  TEST_ASSERT_EQUAL(rt::ZipReader::Error::kNone, reader.error());
}

void test_something_that_is_not_a_zip_is_refused_as_such() {
  const std::string text = "{\"not\":\"a zip\"}";
  Recorder recorder;
  rt::ZipReader reader(recorder);
  TEST_ASSERT_FALSE(reader.feed(reinterpret_cast<const uint8_t *>(text.data()), text.size()));
  TEST_ASSERT_EQUAL(rt::ZipReader::Error::kNotZip, reader.error());
  TEST_ASSERT_EQUAL_size_t(0, recorder.seen.size());
}

void test_garbage_after_an_entry_is_corrupt_not_not_zip() {
  std::vector<uint8_t> bytes = archive({{"a.txt", "hello"}});
  bytes.resize(30 + 5 + 5);
  bytes.insert(bytes.end(), {'J', 'U', 'N', 'K'});
  Recorder recorder;
  rt::ZipReader reader(recorder);
  TEST_ASSERT_FALSE(reader.feed(bytes.data(), bytes.size()));
  TEST_ASSERT_EQUAL(rt::ZipReader::Error::kCorrupt, reader.error());
}

// Every feature ZipWriter never uses is a way a re-zipped backup looks.
void assert_header_patch_is_unsupported(size_t offset, uint8_t value) {
  std::vector<uint8_t> bytes = archive({{"a.txt", "hello"}});
  bytes[offset] = value;
  Recorder recorder;
  rt::ZipReader reader(recorder);
  TEST_ASSERT_FALSE(reader.feed(bytes.data(), bytes.size()));
  TEST_ASSERT_EQUAL(rt::ZipReader::Error::kUnsupported, reader.error());
  TEST_ASSERT_EQUAL_size_t(0, recorder.seen.size());
}

void test_a_deflated_entry_is_unsupported() {
  assert_header_patch_is_unsupported(8, 8);
}

void test_an_encrypted_entry_is_unsupported() {
  assert_header_patch_is_unsupported(6, 0x01);
}

void test_a_data_descriptor_is_unsupported() {
  assert_header_patch_is_unsupported(6, 0x08);
}

void test_a_zip64_size_is_unsupported() {
  std::vector<uint8_t> bytes = archive({{"a.txt", "hello"}});
  for (size_t i = 18; i < 26; ++i) bytes[i] = 0xFF;
  Recorder recorder;
  rt::ZipReader reader(recorder);
  TEST_ASSERT_FALSE(reader.feed(bytes.data(), bytes.size()));
  TEST_ASSERT_EQUAL(rt::ZipReader::Error::kUnsupported, reader.error());
}

void test_an_extra_field_is_skipped_over() {
  // Hand-built: ZipWriter never writes one, but every other zip tool does.
  std::vector<uint8_t> bytes = archive({{"a.txt", "hi"}});
  bytes[28] = 4;  // extra length
  bytes.insert(bytes.begin() + 30 + 5, {0xAA, 0xBB, 0xCC, 0xDD});
  Recorder recorder;
  rt::ZipReader reader(recorder);
  TEST_ASSERT_TRUE(feed_in_chunks(reader, bytes, 1));
  TEST_ASSERT_EQUAL_size_t(1, recorder.seen.size());
  TEST_ASSERT_EQUAL_STRING("hi", recorder.seen[0].body.c_str());
  TEST_ASSERT_TRUE(recorder.seen[0].crc_ok);
}

void test_a_visitor_that_stops_stops_the_reader() {
  const std::vector<uint8_t> bytes = archive(kEntries);
  Recorder recorder;
  recorder.stop_at = 1;
  rt::ZipReader reader(recorder);
  TEST_ASSERT_FALSE(reader.feed(bytes.data(), bytes.size()));
  TEST_ASSERT_EQUAL(rt::ZipReader::Error::kStopped, reader.error());
  TEST_ASSERT_EQUAL_size_t(1, recorder.seen.size());
  TEST_ASSERT_FALSE(reader.feed(bytes.data(), 1));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_every_entry_arrives_whole_in_any_chunking);
  RUN_TEST(test_an_empty_archive_is_complete_with_no_entries);
  RUN_TEST(test_a_flipped_payload_byte_fails_only_that_entrys_crc);
  RUN_TEST(test_a_truncated_archive_is_not_complete);
  RUN_TEST(test_something_that_is_not_a_zip_is_refused_as_such);
  RUN_TEST(test_garbage_after_an_entry_is_corrupt_not_not_zip);
  RUN_TEST(test_a_deflated_entry_is_unsupported);
  RUN_TEST(test_an_encrypted_entry_is_unsupported);
  RUN_TEST(test_a_data_descriptor_is_unsupported);
  RUN_TEST(test_a_zip64_size_is_unsupported);
  RUN_TEST(test_an_extra_field_is_skipped_over);
  RUN_TEST(test_a_visitor_that_stops_stops_the_reader);
  return UNITY_END();
}
