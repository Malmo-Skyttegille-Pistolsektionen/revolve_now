// ============================================================================
//  rt_logic/backup.h
//  What a device backup holds, and how a restore applies one (#520, D-48).
//  Host-testable: the filesystem and NVS are behind RestoreStore. Mirrored by
//  `restoreArchive` in webapp/test/mock-server/server.ts - change both.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "hardware_config.h"
#include "problem.h"
#include "program.h"
#include "zip_reader.h"

namespace rt::backup {

// The archive, in the order GET /backup writes it and a restore needs it:
// backup.json (which names the clips) first, clips before the programs that
// play them. backup.json is described by contracts/backup.schema.json.
constexpr const char *kBackupEntry = "backup.json";
constexpr const char *kAudioDir = "audio/";
constexpr const char *kProgramDir = "programs/";

constexpr const char *kFormat = "revolve-now-backup";
// The layout above. A restore refuses a higher number, since it cannot know
// what it would be leaving out.
constexpr int32_t kFormatVersion = 1;

// backup.json: where the backup came from, the hardware overrides, and the
// clips' titles, which a .wav does not carry.
struct Manifest {
  int32_t format_version = kFormatVersion;
  // The release that wrote it, so a restore across versions can say so.
  std::string firmware_version;
  std::string hostname;
  std::string display_name;
  // `hardware` as JSON text: the overrides of the compiled defaults. Empty
  // when the document has none.
  std::string hardware;
  std::map<int32_t, std::string> audio_titles;
};

std::string backup_json(const Manifest &manifest);

// False with `error` set when the document is not a backup this firmware can
// read. A malformed `audios` only costs the titles; a malformed `hardware` is
// kept as text, for the restore to refuse on its own.
bool parse_backup(const std::string &json, Manifest &out, std::string &error);

// `audio/<id>.wav`, `programs/<id>.json`. False for anything else.
bool parse_audio_entry(const std::string &name, int32_t &id);
bool parse_program_entry(const std::string &name, int32_t &id);

// Points a restored program at the ids its clips were given on this device.
// Shipped clips keep their ids. An uploaded id with no mapping is removed
// rather than kept - on this device it would name somebody else's clip - and
// returned, so the report can say which.
std::vector<int32_t> remap_audio_ids(Program &program, const std::map<int32_t, int32_t> &ids,
                                     int32_t first_upload_id);

// Same series, events and text, whatever the ids. Two programs that would run
// identically are the same program for a restore's purposes.
bool same_program_content(const Program &a, const Program &b);

enum class ItemResult { kAdded, kSkipped, kRefused };

struct ItemOutcome {
  ItemResult result = ItemResult::kRefused;
  // kAdded: the new id. kSkipped: the identical one already here.
  int32_t id = -1;
  const ProblemType *problem = nullptr;
  std::string detail;

  static ItemOutcome added(int32_t id) { return {ItemResult::kAdded, id, nullptr, {}}; }
  static ItemOutcome skipped(int32_t id) { return {ItemResult::kSkipped, id, nullptr, {}}; }
  static ItemOutcome refused(const ProblemType &problem, std::string detail) {
    return {ItemResult::kRefused, -1, &problem, std::move(detail)};
  }
};

// The device side of a restore. Implemented over the repositories and NVS in
// main/backup/, and by a fake in host_test.
class RestoreStore {
 public:
  virtual ~RestoreStore() = default;

  // A clip arrives in pieces into a staging file; commit validates it and
  // either stores it, finds an identical upload, or refuses it. Discard drops
  // whatever is staged.
  virtual bool audio_open() = 0;
  virtual bool audio_write(const uint8_t *data, size_t len) = 0;
  virtual ItemOutcome audio_commit(const std::string &title) = 0;
  virtual void audio_discard() = 0;

  // Stores `program` as a new upload, or reports the identical one already
  // here.
  virtual ItemOutcome program_add(const Program &program) = 0;

  virtual bool config_window_open() = 0;
  virtual HardwareConfig hardware_saved() = 0;
  virtual HardwareConfig hardware_defaults() = 0;
  virtual ConfigRefusal hardware_save(const HardwareConfig &config, ValidationDetail *detail) = 0;
};

struct RestoreOptions {
  bool hardware = true;
  // The hostname and display name. Off by default: restoring them onto a
  // second board makes two boards answer to one name.
  bool name = false;
};

// What this device allows: main/config.h's values, passed in so rt_logic does
// not depend on main/.
struct RestoreLimits {
  // Below this an id is shipped; at or above it, uploaded.
  int32_t first_upload_id = 1000;
  size_t max_program_bytes = 64 * 1024;
  size_t max_audio_bytes = 1024 * 1024;
  // backup.json, which names every clip; titles have no length limit.
  size_t max_document_bytes = 256 * 1024;
};

// A restore, entry by entry, as the upload arrives. Each item is applied the
// moment its entry ends and validated by the running firmware exactly as an
// upload would be; one that is refused is reported and the rest carry on.
//
// backup.json must come first. Until it has been read nothing is applied, so
// a file that is not a backup is refused as a whole (`fatal()`). After it,
// whatever goes wrong with the archive stops the restore where it is and is
// reported alongside what was already restored (`report_json()`).
class RestoreSession : public ZipReader::Visitor {
 public:
  RestoreSession(RestoreStore &store, RestoreOptions options, RestoreLimits limits = {})
      : store_(store), options_(options), limits_(limits), reader_(*this) {}

  // The upload's file part, in order.
  bool feed(const uint8_t *data, size_t len);

  // The body is over. Settles a truncated archive either way.
  void finish();

  // The 400, when the file was refused before anything was applied.
  const ProblemType *fatal() const { return fatal_; }
  const std::string &fatal_detail() const { return fatal_detail_; }

  // The 200's body.
  std::string report_json() const;

  bool programs_changed() const { return programs_changed_; }
  bool audios_changed() const { return audios_changed_; }

  bool on_entry(const ZipReader::Entry &entry) override;
  bool on_data(const uint8_t *data, size_t len) override;
  bool on_entry_end(bool crc_ok) override;

  enum class HardwareResult { kNotIncluded, kNotRequested, kSaved, kUnchanged, kSkipped, kRefused };

 private:
  enum class Kind { kBackup, kAudio, kProgram, kIgnored };

  struct Item {
    int32_t source_id = 0;
    std::string title;
    ItemOutcome outcome;
    std::vector<int32_t> dropped_audio_ids;
  };

  bool stop(const ProblemType &problem, std::string detail);
  void reader_failed();
  void end_backup();
  void end_hardware();
  void end_audio(bool crc_ok);
  void end_program(bool crc_ok);

  RestoreStore &store_;
  RestoreOptions options_;
  RestoreLimits limits_;
  ZipReader reader_;

  bool manifest_read_ = false;
  bool finished_ = false;
  Manifest manifest_;

  Kind kind_ = Kind::kIgnored;
  int32_t entry_id_ = 0;
  std::string buffer_;
  bool too_large_ = false;
  bool audio_staged_ = false;

  std::map<int32_t, int32_t> audio_ids_;

  std::vector<Item> audios_;
  std::vector<Item> programs_;
  bool audios_changed_ = false;
  bool programs_changed_ = false;

  HardwareResult hardware_ = HardwareResult::kNotIncluded;
  const ProblemType *hardware_problem_ = nullptr;
  std::string hardware_detail_;

  const ProblemType *fatal_ = nullptr;
  std::string fatal_detail_;
  const ProblemType *stopped_ = nullptr;
  std::string stopped_detail_;
};

}  // namespace rt::backup
