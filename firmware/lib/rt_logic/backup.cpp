#include "backup.h"

#include <ArduinoJson.h>

#include <algorithm>
#include <string_view>

#include "hardware_json.h"
#include "json_util.h"
#include "text_parse.h"

namespace rt::backup {
namespace {

bool parse_entry(const std::string &name, std::string_view dir, std::string_view ext, int32_t &id) {
  const std::string_view whole(name);
  if (whole.size() <= dir.size() + ext.size()) return false;
  if (whole.substr(0, dir.size()) != dir) return false;
  if (whole.substr(whole.size() - ext.size()) != ext) return false;
  return parse_decimal_u31(whole.substr(dir.size(), whole.size() - dir.size() - ext.size()), id);
}

const char *item_result_name(ItemResult result) {
  switch (result) {
    case ItemResult::kAdded:
      return "added";
    case ItemResult::kSkipped:
      return "skipped";
    case ItemResult::kRefused:
      return "refused";
  }
  return "refused";
}

const char *hardware_result_name(RestoreSession::HardwareResult result) {
  switch (result) {
    case RestoreSession::HardwareResult::kNotIncluded:
      return "notIncluded";
    case RestoreSession::HardwareResult::kNotRequested:
      return "notRequested";
    case RestoreSession::HardwareResult::kSaved:
      return "saved";
    case RestoreSession::HardwareResult::kUnchanged:
      return "unchanged";
    case RestoreSession::HardwareResult::kSkipped:
      return "skipped";
    case RestoreSession::HardwareResult::kRefused:
      return "refused";
  }
  return "notIncluded";
}

constexpr const char *kDamaged =
    "The entry does not match its checksum - the file is damaged. Download a new backup.";

}  // namespace

std::string manifest_json(const Manifest &manifest) {
  std::string out = "{\"format\":";
  out += json_quote(kFormat);
  out += ",\"formatVersion\":";
  out += std::to_string(manifest.format_version);
  out += ",\"firmwareVersion\":";
  out += json_quote(manifest.firmware_version);
  out += ",\"hostname\":";
  out += json_quote(manifest.hostname);
  out += ",\"displayName\":";
  out += json_quote(manifest.display_name);
  // Said in the file, so whoever opens it does not have to wonder whether it
  // is safe to pass around.
  out += ",\"includesWifiCredentials\":false}";
  return out;
}

bool parse_manifest(const std::string &json, Manifest &out, std::string &error) {
  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok || !doc.is<JsonObject>() ||
      std::string_view(doc["format"] | "") != kFormat) {
    error = "Not a backup: manifest.json does not describe a Revolve Now backup.";
    return false;
  }
  if (!doc["formatVersion"].is<int32_t>()) {
    error = "Not a backup: manifest.json has no format version.";
    return false;
  }
  out.format_version = doc["formatVersion"].as<int32_t>();
  if (out.format_version < 1 || out.format_version > kFormatVersion) {
    error = "This backup is in format " + std::to_string(out.format_version) +
            ", which this firmware cannot read. Update the firmware and try again.";
    return false;
  }
  out.firmware_version = doc["firmwareVersion"] | "";
  out.hostname = doc["hostname"] | "";
  out.display_name = doc["displayName"] | "";
  return true;
}

std::string audio_index_json(const std::map<int32_t, std::string> &titles) {
  std::string out = "{";
  for (const auto &[id, title] : titles) {
    if (out.size() > 1) out += ',';
    out += json_quote(std::to_string(id));
    out += ":{\"title\":";
    out += json_quote(title);
    out += '}';
  }
  out += '}';
  return out;
}

bool parse_audio_entry(const std::string &name, int32_t &id) {
  return parse_entry(name, kAudioDir, ".wav", id);
}

bool parse_program_entry(const std::string &name, int32_t &id) {
  return parse_entry(name, kProgramDir, ".json", id);
}

std::vector<int32_t> remap_audio_ids(Program &program, const std::map<int32_t, int32_t> &ids,
                                     int32_t first_upload_id) {
  std::vector<int32_t> dropped;
  for (Series &series : program.series) {
    for (Event &event : series.events) {
      std::vector<int32_t> kept;
      kept.reserve(event.audio_ids.size());
      for (const int32_t id : event.audio_ids) {
        if (id < first_upload_id) {
          kept.push_back(id);
          continue;
        }
        const auto mapped = ids.find(id);
        if (mapped != ids.end()) {
          kept.push_back(mapped->second);
        } else if (std::find(dropped.begin(), dropped.end(), id) == dropped.end()) {
          dropped.push_back(id);
        }
      }
      event.audio_ids = kept;
    }
  }
  return dropped;
}

bool same_program_content(const Program &a, const Program &b) {
  Program left = a;
  Program right = b;
  left.id = right.id = 0;
  left.readonly = right.readonly = false;
  return program_json(left) == program_json(right);
}

// --- RestoreSession --------------------------------------------------------

bool RestoreSession::stop(const ProblemType &problem, std::string detail) {
  if (manifest_read_) {
    if (stopped_ == nullptr) {
      stopped_ = &problem;
      stopped_detail_ = std::move(detail);
    }
  } else if (fatal_ == nullptr) {
    fatal_ = &problem;
    fatal_detail_ = std::move(detail);
  }
  return false;
}

bool RestoreSession::feed(const uint8_t *data, size_t len) {
  if (finished_ || fatal_ != nullptr || stopped_ != nullptr) return false;
  if (!reader_.feed(data, len)) {
    reader_failed();
    return false;
  }
  return true;
}

// The reader's own refusals. kStopped is ours, and already recorded.
void RestoreSession::reader_failed() {
  switch (reader_.error()) {
    case ZipReader::Error::kNone:
    case ZipReader::Error::kStopped:
      break;
    case ZipReader::Error::kNotZip:
      stop(problem::kBackupInvalid, "Not a backup: the file is not a ZIP archive.");
      break;
    case ZipReader::Error::kUnsupported:
      stop(problem::kBackupInvalid,
           "The archive is compressed, encrypted or otherwise not as the device wrote it. Restore "
           "the file exactly as it was downloaded, not a copy that was unpacked and zipped again.");
      break;
    case ZipReader::Error::kCorrupt:
      stop(problem::kBackupInvalid, "The archive is damaged. Download a new backup.");
      break;
  }
}

void RestoreSession::finish() {
  if (finished_) return;
  finished_ = true;
  if (audio_staged_) {
    store_.audio_discard();
    audio_staged_ = false;
  }
  if (fatal_ != nullptr || stopped_ != nullptr) return;
  if (!manifest_read_) {
    stop(problem::kBackupInvalid, reader_.entries() == 0
                                      ? "Not a backup: the file is empty or not a ZIP archive."
                                      : "Not a backup: it has no manifest.json.");
  } else if (!reader_.complete()) {
    stop(problem::kBackupInvalid,
         "The file ended before the backup did - it was cut short. What is listed was restored.");
  }
}

bool RestoreSession::on_entry(const ZipReader::Entry &entry) {
  buffer_.clear();
  too_large_ = false;
  entry_id_ = 0;

  if (!manifest_read_) {
    // Nothing is applied before the manifest has said this is a backup we can
    // read, which is what lets everything up to here be refused as a whole.
    if (entry.name != kManifestEntry) {
      return stop(problem::kBackupInvalid, "Not a backup: it does not start with manifest.json.");
    }
    kind_ = Kind::kManifest;
  } else if (entry.name == kHardwareEntry) {
    kind_ = Kind::kHardware;
  } else if (entry.name == kAudioIndexEntry) {
    kind_ = Kind::kAudioIndex;
  } else if (parse_audio_entry(entry.name, entry_id_)) {
    kind_ = Kind::kAudio;
    too_large_ = entry.size > limits_.max_audio_bytes;
    audio_staged_ = !too_large_ && store_.audio_open();
  } else if (parse_program_entry(entry.name, entry_id_)) {
    kind_ = Kind::kProgram;
  } else {
    // Something a later format added. Passed over rather than refused, so an
    // older device restores what it understands.
    kind_ = Kind::kIgnored;
  }

  const size_t limit =
      kind_ == Kind::kProgram ? limits_.max_program_bytes : limits_.max_document_bytes;
  if (kind_ != Kind::kAudio && kind_ != Kind::kIgnored && entry.size > limit) {
    if (kind_ == Kind::kManifest) {
      return stop(problem::kBackupInvalid, "Not a backup: manifest.json is implausibly large.");
    }
    too_large_ = true;
  }
  return true;
}

bool RestoreSession::on_data(const uint8_t *data, size_t len) {
  if (too_large_) return true;
  switch (kind_) {
    case Kind::kAudio:
      if (audio_staged_ && !store_.audio_write(data, len)) {
        store_.audio_discard();
        audio_staged_ = false;
      }
      return true;
    case Kind::kIgnored:
      return true;
    default:
      buffer_.append(reinterpret_cast<const char *>(data), len);
      return true;
  }
}

bool RestoreSession::on_entry_end(bool crc_ok) {
  switch (kind_) {
    case Kind::kManifest:
      if (!crc_ok) return stop(problem::kBackupInvalid, kDamaged);
      end_manifest();
      return fatal_ == nullptr;
    case Kind::kHardware:
      if (!crc_ok || too_large_) {
        hardware_ = HardwareResult::kRefused;
        hardware_problem_ = &problem::kBackupInvalid;
        hardware_detail_ = crc_ok ? "hardware.json is implausibly large." : kDamaged;
      } else {
        end_hardware();
      }
      return true;
    case Kind::kAudioIndex:
      // Without it the clips still restore, under placeholder titles.
      if (crc_ok && !too_large_) end_audio_index();
      return true;
    case Kind::kAudio:
      end_audio(crc_ok);
      return true;
    case Kind::kProgram:
      end_program(crc_ok);
      return true;
    case Kind::kIgnored:
      return true;
  }
  return true;
}

void RestoreSession::end_manifest() {
  std::string error;
  if (!parse_manifest(buffer_, manifest_, error)) {
    stop(problem::kBackupInvalid, error);
    return;
  }
  manifest_read_ = true;
}

void RestoreSession::end_hardware() {
  if (!options_.hardware) {
    hardware_ = HardwareResult::kNotRequested;
    return;
  }

  // The same gesture PUT /config/hardware is behind: these are the settings
  // whose recovery can need a cable.
  if (!store_.config_window_open()) {
    hardware_ = HardwareResult::kSkipped;
    hardware_problem_ = &problem::kHardwareConfigWindowClosed;
    hardware_detail_ = kOpenWindowHint;
    return;
  }

  // The backup holds overrides, so the result is this build's defaults with
  // those applied - a board ends up configured as the one backed up, not as a
  // merge of the two.
  const HardwareConfig saved = store_.hardware_saved();
  HardwareConfig config = store_.hardware_defaults();
  const PatchError shape = apply_hardware_patch(buffer_, config);
  if (shape != PatchError::kNone) {
    hardware_ = HardwareResult::kRefused;
    hardware_problem_ = shape == PatchError::kSerialOnly ? &problem::kHardwareConfigSerialOnly
                                                         : &problem::kHardwareConfigInvalid;
    hardware_detail_ = patch_error_message(shape);
    return;
  }
  // Never from a backup: serial-only (D-31).
  config.targets_shown_at_boot = saved.targets_shown_at_boot;
  if (!options_.name) {
    config.hostname = saved.hostname;
    config.display_name = saved.display_name;
  }

  // Bank names are not wiring, so same_config does not see them; a restore
  // that changes only a name still changed something.
  if (same_config(config, saved) && config.banks == saved.banks) {
    hardware_ = HardwareResult::kUnchanged;
    return;
  }

  ValidationDetail detail;
  const ConfigRefusal refusal = store_.hardware_save(config, &detail);
  if (refusal != ConfigRefusal::kNone) {
    hardware_ = HardwareResult::kRefused;
    hardware_problem_ = &problem::kHardwareConfigInvalid;
    hardware_detail_ = refusal_message(refusal, detail);
    return;
  }
  hardware_ = HardwareResult::kSaved;
}

void RestoreSession::end_audio_index() {
  JsonDocument doc;
  if (deserializeJson(doc, buffer_) != DeserializationError::Ok || !doc.is<JsonObject>()) return;
  for (JsonPair kv : doc.as<JsonObject>()) {
    int32_t id = 0;
    if (!parse_decimal_u31(kv.key().c_str(), id)) continue;
    const char *title = kv.value()["title"] | "";
    if (*title != '\0') audio_titles_[id] = title;
  }
}

void RestoreSession::end_audio(bool crc_ok) {
  Item item;
  item.source_id = entry_id_;
  const auto title = audio_titles_.find(entry_id_);
  item.title =
      title != audio_titles_.end() ? title->second : "Restored clip " + std::to_string(entry_id_);

  if (too_large_) {
    item.outcome = ItemOutcome::refused(problem::kAudioFormatUnsupported,
                                        "The clip is larger than the 1 MiB upload limit.");
  } else if (!audio_staged_) {
    item.outcome =
        ItemOutcome::refused(problem::kAudioStoreFailed, "The clip could not be written to flash.");
  } else if (!crc_ok) {
    store_.audio_discard();
    item.outcome = ItemOutcome::refused(problem::kBackupInvalid, kDamaged);
  } else {
    item.outcome = store_.audio_commit(item.title);
  }
  audio_staged_ = false;

  if (item.outcome.result != ItemResult::kRefused) audio_ids_[entry_id_] = item.outcome.id;
  if (item.outcome.result == ItemResult::kAdded) audios_changed_ = true;
  audios_.push_back(std::move(item));
}

void RestoreSession::end_program(bool crc_ok) {
  Item item;
  item.source_id = entry_id_;

  Program program;
  if (too_large_) {
    item.outcome = ItemOutcome::refused(problem::kProgramInvalid, "The program is too large.");
  } else if (!crc_ok) {
    item.outcome = ItemOutcome::refused(problem::kBackupInvalid, kDamaged);
  } else if (!parse_program(buffer_, false, program)) {
    item.outcome =
        ItemOutcome::refused(problem::kProgramInvalid, "This firmware cannot read the program.");
  } else {
    item.title = program.title;
    item.dropped_audio_ids = remap_audio_ids(program, audio_ids_, limits_.first_upload_id);
    item.outcome = store_.program_add(program);
  }

  if (item.outcome.result == ItemResult::kAdded) programs_changed_ = true;
  programs_.push_back(std::move(item));
}

std::string RestoreSession::report_json() const {
  const auto items = [](const std::vector<Item> &list) {
    std::string out = "[";
    for (const Item &item : list) {
      if (out.size() > 1) out += ',';
      out += "{\"sourceId\":";
      out += std::to_string(item.source_id);
      out += ",\"title\":";
      out += json_quote(item.title);
      out += ",\"result\":";
      out += json_quote(item_result_name(item.outcome.result));
      if (item.outcome.result != ItemResult::kRefused) {
        out += ",\"id\":";
        out += std::to_string(item.outcome.id);
      } else if (item.outcome.problem != nullptr) {
        out += ",\"problem\":";
        out += problem_json(*item.outcome.problem, item.outcome.detail);
      }
      if (!item.dropped_audio_ids.empty()) {
        out += ",\"droppedAudioIds\":[";
        for (size_t i = 0; i < item.dropped_audio_ids.size(); ++i) {
          if (i > 0) out += ',';
          out += std::to_string(item.dropped_audio_ids[i]);
        }
        out += ']';
      }
      out += '}';
    }
    out += ']';
    return out;
  };

  std::string out = "{\"source\":{\"formatVersion\":";
  out += std::to_string(manifest_.format_version);
  out += ",\"firmwareVersion\":";
  out += json_quote(manifest_.firmware_version);
  out += ",\"hostname\":";
  out += json_quote(manifest_.hostname);
  out += ",\"displayName\":";
  out += json_quote(manifest_.display_name);
  out += "},\"hardware\":{\"result\":";
  out += json_quote(hardware_result_name(hardware_));
  if (hardware_problem_ != nullptr) {
    out += ",\"problem\":";
    out += problem_json(*hardware_problem_, hardware_detail_);
  }
  out += "},\"audios\":";
  out += items(audios_);
  out += ",\"programs\":";
  out += items(programs_);
  if (stopped_ != nullptr) {
    out += ",\"stoppedEarly\":";
    out += problem_json(*stopped_, stopped_detail_);
  }
  out += '}';
  return out;
}

}  // namespace rt::backup
