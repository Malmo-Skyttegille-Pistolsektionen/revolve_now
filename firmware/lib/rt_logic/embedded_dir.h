// ============================================================================
//  rt_logic/embedded_dir.h
//  Directory iteration over the embedded filesystem's index - host-testable,
//  no VFS.
//
//  The index pack_assets.py emits is a flat list of full paths sorted by path;
//  directories are implied by the paths and never stored. Turning that into
//  "the children of /programs" is parsing, so it lives here where
//  host_test/test_embedded_dir reaches it, and main/storage/embedded_fs.cpp
//  keeps only the VFS plumbing.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>

namespace rt {

// One file in the embedded blob, as tools/pack_assets.py writes it into the
// generated RT_EMBEDDED_ENTRIES initialiser.
struct EmbeddedEntry {
  const char *path;
  uint32_t offset;
  uint32_t size;
};

// Longest directory opendir() accepts, including the terminator.
constexpr size_t kEmbeddedDirPrefixMax = 80;

// sizeof(dirent::d_name) on the target; embedded_fs.cpp asserts they agree. A
// child name that does not fit is skipped rather than truncated.
constexpr size_t kEmbeddedNameMax = 256;

// Whether anything lives under `path` as a directory: an entry prefixed by
// `path/`. The empty path and "/" are the mount root, which always is one.
bool embedded_is_directory(const EmbeddedEntry *entries, size_t count, const char *path);

struct EmbeddedDirCursor {
  char prefix[kEmbeddedDirPrefixMax];
  size_t prefix_len;
  size_t next;  // index into the entries
  long offset;  // for telldir/seekdir, counted in entries yielded
  // The name most recently yielded, which is also what embedded_dir_next
  // returns. Entries are sorted, so every file under one subdirectory is
  // adjacent, and comparing against this is how a directory is reported once.
  char last[kEmbeddedNameMax];
};

// Starts a walk of `name`. Trailing slashes are dropped and "/" becomes the
// empty prefix. False when the name does not fit (ENAMETOOLONG); whether it
// is a directory at all is the caller's question.
bool embedded_dir_open(EmbeddedDirCursor &cursor, const char *name);

// Advances to the next immediate child. On true, cursor.last holds its name
// and `is_dir` says whether it is a directory; false at the end.
bool embedded_dir_next(EmbeddedDirCursor &cursor, const EmbeddedEntry *entries, size_t count,
                       bool &is_dir);

// Rewinds and replays the first `offset` children: the mapping from an offset
// to a position in the entries is not arithmetic (a directory collapses
// several entries into one), so replaying is the only honest way back.
void embedded_dir_seek(EmbeddedDirCursor &cursor, const EmbeddedEntry *entries, size_t count,
                       long offset);

}  // namespace rt
