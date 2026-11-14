// ============================================================================
//  rt_logic/zip_reader.h
//  Reading a stored ZIP as it arrives off a socket. Host-testable, no ESP-IDF.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace rt {

// The reading half of zip_writer.h, for the restore upload (#520).
//
// Forward-only, from the local headers: a backup is several megabytes and
// arrives in chunks, so nothing can wait for the central directory at the end.
// Reading stops cleanly at the first central-directory record.
//
// It reads what ZipWriter writes - **stored entries whose sizes are in the
// local header** - and refuses anything else rather than guessing: a deflated
// entry, an encrypted one, a data descriptor (sizes deferred until after the
// payload) or zip64. A backup re-zipped by another tool is the case that
// meets those, and it is refused as a whole before anything is applied.
class ZipReader {
 public:
  enum class Error {
    kNone,
    // The first four bytes are not a local header: not a ZIP at all.
    kNotZip,
    // A ZIP, but using a feature listed above.
    kUnsupported,
    // A signature where an entry or the directory should start, mid-stream.
    kCorrupt,
    // The visitor asked to stop.
    kStopped,
  };

  struct Entry {
    std::string name;
    uint32_t size = 0;
    uint32_t crc = 0;
  };

  // Callbacks per entry, in archive order. Returning false from any of them
  // stops the reader with kStopped.
  class Visitor {
   public:
    virtual ~Visitor() = default;
    virtual bool on_entry(const Entry &entry) = 0;
    virtual bool on_data(const uint8_t *data, size_t len) = 0;
    // `crc_ok` compares the bytes that arrived with the header's CRC.
    virtual bool on_entry_end(bool crc_ok) = 0;
  };

  // Longest entry name accepted. Ours are short; a name longer than this is
  // not one of ours and is refused as unsupported rather than buffered.
  static constexpr size_t kMaxNameBytes = 255;

  explicit ZipReader(Visitor &visitor) : visitor_(visitor) {}

  // Consumes `len` bytes. False once an error has latched; everything after it
  // is ignored.
  bool feed(const uint8_t *data, size_t len);

  // True when the central directory was reached - every entry arrived whole.
  // A body that ends anywhere else was truncated.
  bool complete() const { return state_ == State::kDone; }

  Error error() const { return error_; }

  // Entries opened so far, which tells a caller "not a ZIP" from "broke after
  // N entries".
  size_t entries() const { return entries_; }

 private:
  enum class State { kHeader, kName, kExtra, kData, kDone, kFailed };

  bool fail(Error error);
  bool start_entry();
  bool open_data();
  bool end_entry();

  Visitor &visitor_;
  State state_ = State::kHeader;
  Error error_ = Error::kNone;

  uint8_t header_[30] = {};
  size_t have_ = 0;
  uint16_t name_len_ = 0;
  uint16_t extra_len_ = 0;
  uint32_t remaining_ = 0;
  uint32_t crc_ = 0;
  size_t entries_ = 0;
  Entry entry_;
};

}  // namespace rt
