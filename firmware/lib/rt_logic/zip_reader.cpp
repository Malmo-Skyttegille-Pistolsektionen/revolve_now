#include "zip_reader.h"

#include <algorithm>

#include "zip_writer.h"

namespace rt {
namespace {

constexpr uint32_t kLocalSig = 0x04034b50;
constexpr uint32_t kCentralSig = 0x02014b50;
constexpr uint32_t kEndSig = 0x06054b50;

constexpr uint16_t kFlagEncrypted = 1u << 0;
constexpr uint16_t kFlagDataDescriptor = 1u << 3;
constexpr uint16_t kMethodStored = 0;
constexpr uint32_t kZip64Marker = 0xFFFFFFFF;

uint16_t u16(const uint8_t *in) {
  return static_cast<uint16_t>(in[0] | (in[1] << 8));
}

uint32_t u32(const uint8_t *in) {
  return static_cast<uint32_t>(in[0]) | (static_cast<uint32_t>(in[1]) << 8) |
         (static_cast<uint32_t>(in[2]) << 16) | (static_cast<uint32_t>(in[3]) << 24);
}

}  // namespace

bool ZipReader::fail(Error error) {
  error_ = error;
  state_ = State::kFailed;
  return false;
}

// The 30-byte local header is complete; decide whether this is an entry we can
// read and what follows it.
bool ZipReader::start_entry() {
  const uint16_t flags = u16(header_ + 6);
  const uint16_t method = u16(header_ + 8);
  const uint32_t compressed = u32(header_ + 18);
  const uint32_t size = u32(header_ + 22);

  if ((flags & (kFlagEncrypted | kFlagDataDescriptor)) != 0 || method != kMethodStored ||
      compressed != size || size == kZip64Marker) {
    return fail(Error::kUnsupported);
  }

  name_len_ = u16(header_ + 26);
  extra_len_ = u16(header_ + 28);
  if (name_len_ == 0 || name_len_ > kMaxNameBytes) return fail(Error::kUnsupported);

  entry_ = Entry{};
  entry_.size = size;
  entry_.crc = u32(header_ + 14);
  entry_.name.reserve(name_len_);
  remaining_ = size;
  crc_ = 0;
  entries_++;
  state_ = State::kName;
  return true;
}

// Name and extra field are through; the payload is next. An empty entry ends
// here, since no data byte will ever arrive to end it.
bool ZipReader::open_data() {
  if (!visitor_.on_entry(entry_)) return fail(Error::kStopped);
  state_ = State::kData;
  return remaining_ != 0 || end_entry();
}

bool ZipReader::end_entry() {
  if (!visitor_.on_entry_end(crc_ == entry_.crc)) return fail(Error::kStopped);
  state_ = State::kHeader;
  have_ = 0;
  return true;
}

bool ZipReader::feed(const uint8_t *data, size_t len) {
  size_t pos = 0;
  while (pos < len) {
    switch (state_) {
      case State::kFailed:
        return false;

      case State::kDone:
        // The central directory and the end record: nothing in them that the
        // local headers did not already say.
        return true;

      case State::kHeader: {
        const size_t take = std::min(sizeof(header_) - have_, len - pos);
        std::copy(data + pos, data + pos + take, header_ + have_);
        have_ += take;
        pos += take;

        // The signature decides before the rest of the header has to arrive:
        // an end record is only 22 bytes and may be all that is left.
        if (have_ >= 4 && have_ - take < 4) {
          const uint32_t sig = u32(header_);
          if (sig == kCentralSig || sig == kEndSig) {
            // An archive with no entries is a ZIP, but it is not one this
            // device wrote; the caller tells that apart by entries() == 0.
            state_ = State::kDone;
            return true;
          }
          if (sig != kLocalSig) return fail(entries_ == 0 ? Error::kNotZip : Error::kCorrupt);
        }
        if (have_ == sizeof(header_) && !start_entry()) return false;
        break;
      }

      case State::kName: {
        const size_t take = std::min<size_t>(name_len_ - entry_.name.size(), len - pos);
        entry_.name.append(reinterpret_cast<const char *>(data + pos), take);
        pos += take;
        if (entry_.name.size() == name_len_) {
          state_ = State::kExtra;
          if (extra_len_ == 0 && !open_data()) return false;
        }
        break;
      }

      case State::kExtra: {
        const size_t take = std::min<size_t>(extra_len_, len - pos);
        extra_len_ = static_cast<uint16_t>(extra_len_ - take);
        pos += take;
        if (extra_len_ == 0 && !open_data()) return false;
        break;
      }

      case State::kData: {
        const size_t take = std::min<size_t>(remaining_, len - pos);
        crc_ = crc32(crc_, data + pos, take);
        if (!visitor_.on_data(data + pos, take)) return fail(Error::kStopped);
        remaining_ -= static_cast<uint32_t>(take);
        pos += take;
        if (remaining_ == 0 && !end_entry()) return false;
        break;
      }
    }
  }
  return true;
}

}  // namespace rt
