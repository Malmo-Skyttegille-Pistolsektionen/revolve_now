#include "ota.h"

#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"

#include "backend_issue.h"
#include "ota_upload.h"
#include "problem.h"
#include "program_executor.h"
#include "restart.h"
#include "sse_hub.h"

namespace ota {
namespace {
const char *TAG = "ota";

esp_ota_handle_t s_handle = 0;
const esp_partition_t *s_partition = nullptr;
volatile bool s_in_progress = false;
uint64_t s_written = 0;

// Single HTTP task, so no lock: only the handler's callbacks touch it.
rt::ota::UploadSession s_session;

// Reset the bookkeeping. Does NOT touch the driver - call only after the handle
// has been released, by esp_ota_end or esp_ota_abort.
void clear() {
  s_handle = 0;
  s_partition = nullptr;
  s_in_progress = false;
  s_written = 0;
}

// Abort an upload whose handle is still open. Must not run after esp_ota_end,
// which has already freed it.
void abort_upload(const char *why) {
  ESP_LOGE(TAG, "Aborting: %s", why);
  if (s_handle != 0) esp_ota_abort(s_handle);
  clear();
}

void raise(rt::ota::Refusal refusal) {
  sse_hub::broadcast_issue(rt::issue_code::kOtaRefused, rt::ota::message(refusal));
}

// Recorded for onRequest's answer, and told to every open page.
void refuse(rt::ota::Refusal refusal) {
  s_session.refuse(refusal);
  raise(refusal);
}

esp_err_t send(PsychicResponse *res, const rt::ota::Answer &answer) {
  if (answer.accepted()) {
    return res->send(200, "application/json", "{\"status\":\"accepted\",\"restarting\":true}");
  }
  return res->send(answer.problem->status, rt::kProblemContentType,
                   rt::problem_json(*answer.problem, answer.detail).c_str());
}

}  // namespace

bool in_progress() {
  return s_in_progress || s_session.restart_pending();
}

void register_routes(PsychicHttpServer &server, ControlLockGuard require_control_lock) {
  static PsychicUploadHandler upload;
  static ControlLockGuard s_require_control_lock = require_control_lock;

  // Middleware, not onUpload: the chain runs before handleRequest, which is
  // what streams the body to flash. Anything answered here is answered before
  // a byte of it is read.
  upload.addMiddleware([](PsychicRequest *req, PsychicResponse *res,
                          const PsychicMiddlewareNext &next) -> esp_err_t {
    if (!s_require_control_lock(req, res)) return ESP_OK;
    // A client that vanishes mid-transfer never delivers a final chunk, so
    // nothing else closes its handle - and in_progress() would hold off every
    // program start until the next upload.
    if (s_handle != 0) abort_upload("leftover handle from an abandoned upload");
    if (const auto answer = s_session.gate(req->isMultipart())) {
      ESP_LOGW(TAG, "Refused before the body: %s", answer->detail);
      return send(res, *answer);
    }
    return next();
  });

  upload.onUpload([](PsychicRequest *request, const char *filename, uint64_t index, uint8_t *data,
                     size_t len, bool final) -> esp_err_t {
    if (index == 0) {
      ESP_LOGI(TAG, "Upload '%s' starting", filename == nullptr ? "(unnamed)" : filename);

      const bool program_running = executor::is_running();
      if (!s_session.begin(program_running)) {
        ESP_LOGW(TAG, "Refused before writing");
        if (program_running) raise(rt::ota::Refusal::kProgramRunning);
        return ESP_FAIL;
      }

      s_partition = esp_ota_get_next_update_partition(nullptr);
      if (s_partition == nullptr) {
        ESP_LOGE(TAG, "No inactive slot");
        s_session.fail();
        return ESP_FAIL;
      }

      // Sized from Content-Length rather than OTA_SIZE_UNKNOWN. Unknown makes
      // esp_ota_begin erase the whole 3 MB slot before the first byte is
      // written, synchronously, on this HTTP task - measured on hardware as the
      // server going unresponsive for long enough that the client gave up and
      // the device looked hung. Erasing only what the image needs takes a
      // fraction of that. The multipart envelope makes Content-Length slightly
      // larger than the image, which is harmless: a little over is still far
      // under the slot.
      size_t erase_size = OTA_SIZE_UNKNOWN;
      const size_t declared =
          request == nullptr ? 0 : static_cast<size_t>(request->contentLength());
      if (declared > 0 && declared <= s_partition->size) erase_size = declared;

      if (esp_ota_begin(s_partition, erase_size, &s_handle) != ESP_OK) {
        ESP_LOGE(TAG, "Could not open the inactive slot");
        // A failed erase has already handed out a handle.
        if (s_handle != 0) esp_ota_abort(s_handle);
        clear();
        s_session.fail();
        return ESP_FAIL;
      }
      s_in_progress = true;
      s_written = 0;
    }

    if (s_handle == 0) return ESP_FAIL;

    // Validation fails here on the first byte of anything that is not an image.
    const esp_err_t write_err = esp_ota_write(s_handle, data, len);
    if (write_err != ESP_OK) {
      if (write_err == ESP_ERR_OTA_VALIDATE_FAILED) {
        refuse(rt::ota::Refusal::kInvalidImage);
      } else {
        s_session.fail();
      }
      abort_upload("write failed");
      return ESP_FAIL;
    }
    s_written += len;

    if (!final) return ESP_OK;

    // Identity is checked while the handle is still open, so a foreign image is
    // aborted rather than finalised and then disowned. It must never be the
    // boot partition, even for an instant.
    esp_app_desc_t written = {};
    const esp_app_desc_t *running = esp_app_get_description();
    const bool readable = esp_ota_get_partition_description(s_partition, &written) == ESP_OK;

    const rt::ota::Refusal refusal =
        readable ? rt::ota::check_image(written.project_name, running->project_name, s_written)
                 : rt::ota::Refusal::kProjectMismatch;
    if (refusal != rt::ota::Refusal::kNone) {
      ESP_LOGE(TAG, "Refused: %s (image '%s', running '%s')", rt::ota::message(refusal),
               readable ? written.project_name : "unreadable", running->project_name);
      refuse(refusal);
      abort_upload("image refused");
      return ESP_FAIL;
    }

    // esp_ota_end frees the handle either way, so neither branch may abort.
    const esp_err_t end_err = esp_ota_end(s_handle);
    if (end_err != ESP_OK) {
      ESP_LOGE(TAG, "Image failed validation");
      if (end_err == ESP_ERR_OTA_VALIDATE_FAILED) {
        refuse(rt::ota::Refusal::kInvalidImage);
      } else {
        s_session.fail();
      }
      clear();
      return ESP_FAIL;
    }
    if (esp_ota_set_boot_partition(s_partition) != ESP_OK) {
      ESP_LOGE(TAG, "Could not set the boot partition");
      clear();
      s_session.fail();
      return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Accepted %llu bytes, version '%s' - restarting shortly", s_written,
             written.version);
    clear();
    // Only once the restart is on its way: an image that will boot but never
    // does is worse than a refusal.
    const bool scheduled = device_restart::schedule("into the new firmware");
    s_session.install(scheduled);
    return scheduled ? ESP_OK : ESP_FAIL;
  });

  // Always reached for a multipart body, whatever onUpload returned:
  // MultipartProcessor ignores the callback's result.
  upload.onRequest([](PsychicRequest *, PsychicResponse *res) -> esp_err_t {
    return send(res, s_session.respond());
  });

  server.on("/api/v2/ota", HTTP_POST, &upload);
}

}  // namespace ota
