#include "device_backup.h"

#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "audio.h"
#include "audios.h"
#include "backup.h"
#include "boot_button.h"
#include "config.h"
#include "config/hardware_store.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "hardware_json.h"
#include "library_changed.h"
#include "problem.h"
#include "program_executor.h"
#include "programs.h"
#include "sse_hub.h"
#include "storage.h"
#include "text_parse.h"
#include "zip_writer.h"

namespace device_backup {
namespace {

const char *TAG = "backup";

// Beside the audio upload's own staging file, never the same one: a restore and
// an upload are different requests and neither may clean up after the other.
constexpr const char *kRestoreStagingPath = RT_UPLOAD_AUDIO_DIR "/.restore";

// Bytes read from flash per pass, as the troubleshooting bundle does.
constexpr size_t kChunkBytes = 2048;

esp_err_t send_problem(PsychicResponse *res, const rt::ProblemType &type,
                       const std::string &detail) {
  return res->send(type.status, rt::kProblemContentType, rt::problem_json(type, detail).c_str());
}

bool refuse_if_running(PsychicResponse *res, const char *what) {
  if (!executor::is_running()) return false;
  send_problem(res, rt::problem::kProgramRunning,
               std::string("A program is running - stop it before ") + what);
  return true;
}

// --- GET /backup -------------------------------------------------------------

bool send_chunk(void *ctx, const uint8_t *data, size_t len) {
  auto *res = static_cast<PsychicResponse *>(ctx);
  return res->sendChunk(const_cast<uint8_t *>(data), len) == ESP_OK;
}

void add_text(rt::ZipWriter &zip, const std::string &name, const std::string &text) {
  const auto *bytes = reinterpret_cast<const uint8_t *>(text.data());
  zip.begin(name, static_cast<uint32_t>(text.size()), rt::crc32(0, bytes, text.size()));
  zip.write(bytes, text.size());
}

// A stored entry's CRC goes out before its bytes and nothing here can seek
// back, so the file is read twice: once to sum, once to send.
bool sum_file(const std::string &path, std::vector<uint8_t> &buffer, uint32_t &size,
              uint32_t &crc) {
  FILE *f = fopen(path.c_str(), "rb");
  if (f == nullptr) return false;
  size = 0;
  crc = 0;
  size_t got = 0;
  while ((got = fread(buffer.data(), 1, buffer.size(), f)) > 0) {
    crc = rt::crc32(crc, buffer.data(), got);
    size += static_cast<uint32_t>(got);
  }
  const bool ok = ferror(f) == 0;
  fclose(f);
  return ok;
}

void add_file(rt::ZipWriter &zip, const std::string &name, const std::string &path,
              std::vector<uint8_t> &buffer) {
  uint32_t size = 0, crc = 0;
  if (!sum_file(path, buffer, size, crc)) {
    // Left out rather than ending the download: one unreadable clip should not
    // cost the operator every program.
    ESP_LOGW(TAG, "Could not read %s - leaving it out of the backup", path.c_str());
    return;
  }
  FILE *f = fopen(path.c_str(), "rb");
  if (f == nullptr) return;
  zip.begin(name, size, crc);
  uint32_t sent = 0;
  size_t got = 0;
  while (zip.ok() && sent < size && (got = fread(buffer.data(), 1, buffer.size(), f)) > 0) {
    got = std::min<size_t>(got, size - sent);
    zip.write(buffer.data(), got);
    sent += static_cast<uint32_t>(got);
  }
  fclose(f);
  // A file that shrank between the two reads leaves the entry short, which
  // latches the writer and truncates the archive - the client sees that.
}

esp_err_t serve_backup(PsychicRequest *, PsychicResponse *res) {
  // The server answers one request at a time and this one takes seconds, so
  // during a run it would hold the stop button's request behind it.
  if (refuse_if_running(res, "taking a backup")) return ESP_OK;

  const rt::HardwareConfig &active = hardware_store::current();
  rt::backup::Manifest manifest;
  manifest.firmware_version = esp_app_get_description()->version;
  manifest.hostname = active.hostname;
  manifest.display_name = active.display_name;

  // Uploads only: shipped ones come with the image.
  std::map<int32_t, std::string> titles;
  std::vector<std::pair<int32_t, std::string>> clips;
  for (const auto &[id, clip] : audios::all()) {
    if (clip.readonly) continue;
    titles[id] = clip.title;
    clips.emplace_back(id, clip.path);
  }

  const std::string name = rt::filename_safe(active.hostname) + "-" +
                           rt::filename_safe(manifest.firmware_version) + "-backup.zip";
  const std::string disposition = "attachment; filename=\"" + name + "\"";
  res->setCode(200);
  res->setContentType("application/zip");
  res->addHeader("Content-Disposition", disposition.c_str());
  res->sendHeaders();

  // The order a restore needs: titles before clips, clips before the programs
  // that play them.
  rt::ZipWriter zip(send_chunk, res);
  add_text(zip, rt::backup::kManifestEntry, rt::backup::manifest_json(manifest));
  add_text(zip, rt::backup::kHardwareEntry,
           rt::hardware_overrides_json(hardware_store::saved(), hardware_store::defaults()));
  add_text(zip, rt::backup::kAudioIndexEntry, rt::backup::audio_index_json(titles));

  std::vector<uint8_t> buffer(kChunkBytes);
  for (const auto &[id, path] : clips) {
    if (!zip.ok()) break;
    add_file(zip, std::string(rt::backup::kAudioDir) + std::to_string(id) + ".wav", path, buffer);
  }
  for (const auto &[id, program] : programs::all()) {
    if (!zip.ok()) break;
    if (program.readonly) continue;
    add_text(zip, std::string(rt::backup::kProgramDir) + std::to_string(id) + ".json",
             rt::program_json(program));
  }

  zip.finish();
  // The 200 is long gone; a short archive is what the client sees.
  if (!zip.ok()) ESP_LOGW(TAG, "Backup download did not complete");
  return res->finishChunking();
}

// --- POST /restore -----------------------------------------------------------

// The device under a restore: the same repositories and checks an upload goes
// through, one item at a time.
class FlashStore : public rt::backup::RestoreStore {
 public:
  ~FlashStore() override { audio_discard(); }

  bool audio_open() override {
    audio_discard();
    storage::make_dirs(kUploadAudioDir);
    file_ = fopen(kRestoreStagingPath, "wb");
    return file_ != nullptr;
  }

  bool audio_write(const uint8_t *data, size_t len) override {
    return file_ != nullptr && fwrite(data, 1, len, file_) == len;
  }

  rt::backup::ItemOutcome audio_commit(const std::string &title) override {
    const bool closed = file_ != nullptr && fclose(file_) == 0;
    file_ = nullptr;
    if (!closed) {
      audio_discard();
      return rt::backup::ItemOutcome::refused(rt::problem::kAudioStoreFailed,
                                              "The clip could not be written to flash.");
    }

    rt::WavInfo info;
    if (!audio::probe_wav(kRestoreStagingPath, info)) {
      audio_discard();
      return rt::backup::ItemOutcome::refused(rt::problem::kAudioFormatUnsupported,
                                              "Not a WAV this firmware can play.");
    }

    if (const int32_t existing = find_identical_clip(title); existing >= 0) {
      audio_discard();
      return rt::backup::ItemOutcome::skipped(existing);
    }

    const int32_t id = audios::add_uploaded(title, kRestoreStagingPath);
    if (id < 0) {
      audio_discard();
      return rt::backup::ItemOutcome::refused(rt::problem::kAudioStoreFailed,
                                              "The clip could not be stored.");
    }
    return rt::backup::ItemOutcome::added(id);
  }

  void audio_discard() override {
    if (file_ != nullptr) fclose(file_);
    file_ = nullptr;
    (void)::remove(kRestoreStagingPath);
  }

  rt::backup::ItemOutcome program_add(const rt::Program &program) override {
    for (const auto &[id, existing] : programs::all()) {
      if (!existing.readonly && rt::backup::same_program_content(existing, program)) {
        return rt::backup::ItemOutcome::skipped(id);
      }
    }
    const int32_t id = programs::add(program);
    if (id < 0) {
      return rt::backup::ItemOutcome::refused(rt::problem::kProgramStoreFailed,
                                              "The program could not be written to flash.");
    }
    return rt::backup::ItemOutcome::added(id);
  }

  bool config_window_open() override { return boot_button::config_window_open(); }
  rt::HardwareConfig hardware_saved() override { return hardware_store::saved(); }
  rt::HardwareConfig hardware_defaults() override { return hardware_store::defaults(); }
  rt::ConfigRefusal hardware_save(const rt::HardwareConfig &config,
                                  rt::ValidationDetail *detail) override {
    return hardware_store::save(config, detail);
  }

 private:
  // An upload with the same title and the same bytes. Compared byte for byte,
  // which is cheap next to the flash write it saves.
  int32_t find_identical_clip(const std::string &title) {
    std::vector<uint8_t> staged(kChunkBytes), stored(kChunkBytes);
    for (const auto &[id, clip] : audios::all()) {
      if (clip.readonly || clip.title != title) continue;
      if (same_bytes(kRestoreStagingPath, clip.path, staged, stored)) return id;
    }
    return -1;
  }

  static bool same_bytes(const std::string &a_path, const std::string &b_path,
                         std::vector<uint8_t> &a_buf, std::vector<uint8_t> &b_buf) {
    FILE *a = fopen(a_path.c_str(), "rb");
    FILE *b = fopen(b_path.c_str(), "rb");
    bool same = a != nullptr && b != nullptr;
    while (same) {
      const size_t got_a = fread(a_buf.data(), 1, a_buf.size(), a);
      const size_t got_b = fread(b_buf.data(), 1, b_buf.size(), b);
      if (got_a != got_b || memcmp(a_buf.data(), b_buf.data(), got_a) != 0) {
        same = false;
      } else if (got_a == 0) {
        break;
      }
    }
    if (a != nullptr) fclose(a);
    if (b != nullptr) fclose(b);
    return same;
  }

  FILE *file_ = nullptr;
};

// One restore at a time - the server has one task - held across the handler's
// three callbacks. Replaced at the start of every request, so a restore whose
// connection died mid-body is discarded by the next one rather than lingering.
struct Restore {
  FlashStore store;
  rt::backup::RestoreSession session;
  bool received = false;

  Restore(rt::backup::RestoreOptions options, rt::backup::RestoreLimits limits)
      : session(store, options, limits) {}
};
std::unique_ptr<Restore> s_restore;

bool flag(PsychicRequest *req, const char *name, bool fallback) {
  if (!req->hasParam(name)) return fallback;
  PsychicWebParameter *param = req->getParam(name);
  const char *value = param == nullptr ? nullptr : param->value();
  if (value == nullptr) return fallback;
  if (strcmp(value, "true") == 0 || strcmp(value, "1") == 0) return true;
  if (strcmp(value, "false") == 0 || strcmp(value, "0") == 0) return false;
  return fallback;
}

}  // namespace

void register_routes(PsychicHttpServer &server, ControlLockGuard require_control_lock) {
  // Public, like every other GET: nothing in it is a credential, and the
  // programs and hardware configuration are already readable one by one.
  server.on("/api/v2/backup", HTTP_GET, serve_backup);

  static PsychicUploadHandler upload;
  static ControlLockGuard s_require_control_lock = require_control_lock;

  // Middleware, so a refusal is answered before a byte of the body is read.
  upload.addMiddleware([](PsychicRequest *req, PsychicResponse *res,
                          const PsychicMiddlewareNext &next) -> esp_err_t {
    s_restore.reset();
    if (!s_require_control_lock(req, res)) return ESP_OK;
    // The programs it adds are harmless mid-run, but it holds the server for
    // as long as the upload takes, and the stop button with it.
    if (refuse_if_running(res, "restoring a backup")) return ESP_OK;
    if (!req->isMultipart()) {
      return send_problem(res, rt::problem::kUploadMissingFile,
                          "Expected a multipart/form-data body with the backup in a file part");
    }

    rt::backup::RestoreOptions options;
    options.hardware = flag(req, "hardware", true);
    options.name = flag(req, "name", false);
    rt::backup::RestoreLimits limits;
    limits.first_upload_id = kFirstUploadId;
    limits.max_program_bytes = kMaxUploadBytes;
    limits.max_audio_bytes = kMaxUploadBytes;
    s_restore = std::make_unique<Restore>(options, limits);
    return next();
  });

  upload.onUpload(
      [](PsychicRequest *, const char *, uint64_t, uint8_t *data, size_t len, bool) -> esp_err_t {
        if (!s_restore) return ESP_FAIL;
        s_restore->received = s_restore->received || len > 0;
        // A refusal latches inside the session; the rest of the body is read and
        // ignored, so the client gets the report rather than a reset connection.
        s_restore->session.feed(data, len);
        return ESP_OK;
      });

  upload.onRequest([](PsychicRequest *, PsychicResponse *res) -> esp_err_t {
    const std::unique_ptr<Restore> restore = std::move(s_restore);
    if (!restore || !restore->received) {
      return send_problem(res, rt::problem::kUploadMissingFile, "No file uploaded");
    }

    restore->session.finish();
    if (restore->session.programs_changed()) {
      sse_hub::broadcast_library_changed(rt::library_kind::kProgram);
    }
    if (restore->session.audios_changed()) {
      sse_hub::broadcast_library_changed(rt::library_kind::kAudio);
    }

    if (const rt::ProblemType *fatal = restore->session.fatal()) {
      ESP_LOGW(TAG, "Restore refused: %s", restore->session.fatal_detail().c_str());
      return send_problem(res, *fatal, restore->session.fatal_detail());
    }
    ESP_LOGI(TAG, "Restore applied");
    return res->send(200, "application/json", restore->session.report_json().c_str());
  });

  server.on("/api/v2/restore", HTTP_POST, &upload);
}

}  // namespace device_backup
