// ============================================================================
//  Directory iteration over the embedded filesystem's flat, sorted index.
//  `programs::load_dir` walks /embedded/programs through this, so a child
//  missed or reported twice is a shipped program missing or loaded twice.
// ============================================================================
#include <cstring>
#include <string>
#include <vector>

#include "embedded_dir.h"
#include "unity.h"

namespace {

// Sorted by path, the way tools/pack_assets.py emits it.
const rt::EmbeddedEntry kIndex[] = {
    {"/audio/1.wav", 0, 10},
    {"/audio/2.wav", 12, 10},
    {"/audio/audios.json", 24, 5},
    {"/programs/1.json", 32, 3},
    {"/programs/12.json", 36, 3},
    {"/webapp/assets/a.js.gz", 40, 7},
    {"/webapp/assets/b.css.gz", 48, 7},
    {"/webapp/assets/img/logo.png", 56, 7},
    {"/webapp/index.html.gz", 64, 7},
};
constexpr size_t kCount = sizeof(kIndex) / sizeof(kIndex[0]);

// "name/" for a directory, "name" for a file.
std::vector<std::string> list(const char *dir, const rt::EmbeddedEntry *entries = kIndex,
                              size_t count = kCount) {
  rt::EmbeddedDirCursor cursor;
  TEST_ASSERT_TRUE(rt::embedded_dir_open(cursor, dir));
  std::vector<std::string> out;
  bool is_dir = false;
  while (rt::embedded_dir_next(cursor, entries, count, is_dir)) {
    out.push_back(std::string(cursor.last) + (is_dir ? "/" : ""));
  }
  return out;
}

void assert_listing(const std::vector<std::string> &expected,
                    const std::vector<std::string> &actual) {
  TEST_ASSERT_EQUAL_UINT32(expected.size(), actual.size());
  for (size_t i = 0; i < expected.size(); i++) {
    TEST_ASSERT_EQUAL_STRING(expected[i].c_str(), actual[i].c_str());
  }
}

}  // namespace

void setUp() {}
void tearDown() {}

void test_the_root_lists_each_mount_once() {
  assert_listing({"audio/", "programs/", "webapp/"}, list("/"));
  assert_listing({"audio/", "programs/", "webapp/"}, list(""));
}

void test_a_directory_lists_its_files_and_each_subdirectory_once() {
  assert_listing({"1.json", "12.json"}, list("/programs"));
  assert_listing({"assets/", "index.html.gz"}, list("/webapp"));
  assert_listing({"a.js.gz", "b.css.gz", "img/"}, list("/webapp/assets"));
}

void test_trailing_slashes_are_ignored() {
  assert_listing({"1.json", "12.json"}, list("/programs/"));
  assert_listing({"1.json", "12.json"}, list("/programs//"));
  assert_listing({"audio/", "programs/", "webapp/"}, list("//"));
}

// A name prefix is not a directory prefix: "/prog" must not list /programs.
void test_a_name_prefix_is_not_a_parent() {
  TEST_ASSERT_EQUAL_UINT32(0, list("/prog").size());
  TEST_ASSERT_EQUAL_UINT32(0, list("/programs/1.json").size());
}

void test_is_directory() {
  TEST_ASSERT_TRUE(rt::embedded_is_directory(kIndex, kCount, "/"));
  TEST_ASSERT_TRUE(rt::embedded_is_directory(kIndex, kCount, ""));
  TEST_ASSERT_TRUE(rt::embedded_is_directory(kIndex, kCount, "/webapp"));
  TEST_ASSERT_TRUE(rt::embedded_is_directory(kIndex, kCount, "/webapp/assets/img"));
  TEST_ASSERT_FALSE(rt::embedded_is_directory(kIndex, kCount, "/webapp/index.html.gz"));
  TEST_ASSERT_FALSE(rt::embedded_is_directory(kIndex, kCount, "/web"));
  TEST_ASSERT_FALSE(rt::embedded_is_directory(kIndex, kCount, "/missing"));
}

// An API-only build: the packer's one sentinel entry and nothing else.
void test_the_empty_index_sentinel_has_no_children() {
  const rt::EmbeddedEntry sentinel[] = {{"", 0, 0}};
  TEST_ASSERT_EQUAL_UINT32(0, list("/", sentinel, 1).size());
  TEST_ASSERT_TRUE(rt::embedded_is_directory(sentinel, 1, "/"));
  TEST_ASSERT_FALSE(rt::embedded_is_directory(sentinel, 1, "/webapp"));
}

void test_seek_replays_to_an_offset() {
  rt::EmbeddedDirCursor cursor;
  TEST_ASSERT_TRUE(rt::embedded_dir_open(cursor, "/webapp/assets"));
  bool is_dir = false;
  TEST_ASSERT_TRUE(rt::embedded_dir_next(cursor, kIndex, kCount, is_dir));
  TEST_ASSERT_TRUE(rt::embedded_dir_next(cursor, kIndex, kCount, is_dir));
  TEST_ASSERT_EQUAL_INT32(2, cursor.offset);

  rt::embedded_dir_seek(cursor, kIndex, kCount, 1);
  TEST_ASSERT_EQUAL_INT32(1, cursor.offset);
  TEST_ASSERT_TRUE(rt::embedded_dir_next(cursor, kIndex, kCount, is_dir));
  TEST_ASSERT_EQUAL_STRING("b.css.gz", cursor.last);
  TEST_ASSERT_TRUE(rt::embedded_dir_next(cursor, kIndex, kCount, is_dir));
  TEST_ASSERT_EQUAL_STRING("img", cursor.last);
  TEST_ASSERT_TRUE(is_dir);
  TEST_ASSERT_FALSE(rt::embedded_dir_next(cursor, kIndex, kCount, is_dir));

  // Back to the start, and the directory is reported again rather than
  // swallowed by the adjacency check.
  rt::embedded_dir_seek(cursor, kIndex, kCount, 0);
  TEST_ASSERT_TRUE(rt::embedded_dir_next(cursor, kIndex, kCount, is_dir));
  TEST_ASSERT_EQUAL_STRING("a.js.gz", cursor.last);

  rt::embedded_dir_seek(cursor, kIndex, kCount, 2);
  TEST_ASSERT_TRUE(rt::embedded_dir_next(cursor, kIndex, kCount, is_dir));
  TEST_ASSERT_EQUAL_STRING("img", cursor.last);
}

void test_seek_past_the_end_stops_at_the_end() {
  rt::EmbeddedDirCursor cursor;
  TEST_ASSERT_TRUE(rt::embedded_dir_open(cursor, "/programs"));
  rt::embedded_dir_seek(cursor, kIndex, kCount, 99);
  TEST_ASSERT_EQUAL_INT32(2, cursor.offset);
  bool is_dir = false;
  TEST_ASSERT_FALSE(rt::embedded_dir_next(cursor, kIndex, kCount, is_dir));
}

void test_a_directory_name_too_long_is_refused() {
  rt::EmbeddedDirCursor cursor;
  std::string name(rt::kEmbeddedDirPrefixMax - 1, 'a');
  name[0] = '/';
  TEST_ASSERT_TRUE(rt::embedded_dir_open(cursor, name.c_str()));
  name += 'a';
  TEST_ASSERT_FALSE(rt::embedded_dir_open(cursor, name.c_str()));
  // The trailing slash is dropped before the length is judged.
  name.back() = '/';
  TEST_ASSERT_TRUE(rt::embedded_dir_open(cursor, name.c_str()));
}

// A name that would not fit dirent::d_name is skipped, not truncated into a
// different name.
void test_a_child_name_too_long_for_a_dirent_is_skipped() {
  const std::string long_path = "/d/" + std::string(rt::kEmbeddedNameMax, 'x');
  const std::string fits_path = "/d/" + std::string(rt::kEmbeddedNameMax - 1, 'y');
  const rt::EmbeddedEntry entries[] = {
      {long_path.c_str(), 0, 1},
      {fits_path.c_str(), 4, 1},
  };
  const auto listing = list("/d", entries, 2);
  TEST_ASSERT_EQUAL_UINT32(1, listing.size());
  TEST_ASSERT_EQUAL_UINT32(rt::kEmbeddedNameMax - 1, listing[0].size());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_the_root_lists_each_mount_once);
  RUN_TEST(test_a_directory_lists_its_files_and_each_subdirectory_once);
  RUN_TEST(test_trailing_slashes_are_ignored);
  RUN_TEST(test_a_name_prefix_is_not_a_parent);
  RUN_TEST(test_is_directory);
  RUN_TEST(test_the_empty_index_sentinel_has_no_children);
  RUN_TEST(test_seek_replays_to_an_offset);
  RUN_TEST(test_seek_past_the_end_stops_at_the_end);
  RUN_TEST(test_a_directory_name_too_long_is_refused);
  RUN_TEST(test_a_child_name_too_long_for_a_dirent_is_skipped);
  return UNITY_END();
}
