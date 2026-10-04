#include "embedded_dir.h"

#include <cstring>

namespace rt {
namespace {

// The immediate child of `prefix` that `path` lies under, or nullptr. Writes
// the name into `out` and says whether it is a directory.
const char *child_of(const char *path, const char *prefix, size_t prefix_len, char *out,
                     size_t out_size, bool *is_dir) {
  if (strncmp(path, prefix, prefix_len) != 0 || path[prefix_len] != '/') return nullptr;
  const char *rest = path + prefix_len + 1;
  const char *slash = strchr(rest, '/');
  const size_t len = slash != nullptr ? static_cast<size_t>(slash - rest) : strlen(rest);
  if (len == 0 || len >= out_size) return nullptr;
  memcpy(out, rest, len);
  out[len] = '\0';
  *is_dir = slash != nullptr;
  return out;
}

}  // namespace

bool embedded_is_directory(const EmbeddedEntry *entries, size_t count, const char *path) {
  const size_t len = strlen(path);
  if (len == 0 || (len == 1 && path[0] == '/')) return true;
  for (size_t i = 0; i < count; i++) {
    if (strncmp(entries[i].path, path, len) == 0 && entries[i].path[len] == '/') return true;
  }
  return false;
}

bool embedded_dir_open(EmbeddedDirCursor &cursor, const char *name) {
  memset(&cursor, 0, sizeof(cursor));
  // A trailing slash would make every prefix comparison off by one, and `/`
  // is the mount root, whose children have no prefix to strip.
  size_t len = strlen(name);
  while (len > 1 && name[len - 1] == '/') len--;
  if (len == 1 && name[0] == '/') len = 0;
  if (len >= sizeof(cursor.prefix)) return false;
  memcpy(cursor.prefix, name, len);
  cursor.prefix[len] = '\0';
  cursor.prefix_len = len;
  return true;
}

bool embedded_dir_next(EmbeddedDirCursor &cursor, const EmbeddedEntry *entries, size_t count,
                       bool &is_dir) {
  char name[sizeof(cursor.last)];
  while (cursor.next < count) {
    bool child_is_dir = false;
    const char *found = child_of(entries[cursor.next].path, cursor.prefix, cursor.prefix_len, name,
                                 sizeof(name), &child_is_dir);
    cursor.next++;
    if (found == nullptr) continue;
    if (child_is_dir && strcmp(name, cursor.last) == 0) continue;

    memcpy(cursor.last, name, strlen(name) + 1);
    cursor.offset++;
    is_dir = child_is_dir;
    return true;
  }
  return false;
}

void embedded_dir_seek(EmbeddedDirCursor &cursor, const EmbeddedEntry *entries, size_t count,
                       long offset) {
  cursor.next = 0;
  cursor.offset = 0;
  cursor.last[0] = '\0';
  bool is_dir = false;
  while (cursor.offset < offset) {
    if (!embedded_dir_next(cursor, entries, count, is_dir)) break;
  }
}

}  // namespace rt
