// ============================================================================
//  rt_logic/ota_upload.h
//  What POST /api/v2/ota answers, and when.
// ============================================================================
#pragma once

#include <optional>

#include "ota_policy.h"
#include "problem.h"

namespace rt::ota {

// `problem == nullptr` is the 200: accepted, restarting.
struct Answer {
  const ProblemType *problem = nullptr;
  const char *detail = "";

  bool accepted() const { return problem == nullptr; }
};

// The upload handler's state across its three callbacks: the middleware before
// the body, onUpload per chunk, onRequest after it. Their pairing is not
// one-to-one - an empty file part never reaches onUpload, and a gated request
// reaches neither - which is where #342's two defects lived. Every answer is
// decided here; main/ota/ota.cpp only does the flash writes this permits.
class UploadSession {
 public:
  // Before a byte of the body is read, and the only place every request
  // passes - so per-request state is reset here, not in onUpload. An answer
  // ends the request.
  std::optional<Answer> gate(bool multipart) {
    restarting_ = false;
    failed_ = false;
    refusal_ = Refusal::kNone;

    // Ahead of the multipart check: once an image is installed, every upload
    // gets this answer until the device restarts.
    if (installed_) return already_installed();
    if (!multipart) {
      return Answer{&problem::kUploadMissingFile,
                    "Expected a multipart/form-data body with the image in a file part"};
    }
    return std::nullopt;
  }

  // The first chunk. False means write nothing.
  bool begin(bool program_running) {
    // The next update slot counts from the running one, so once an image is
    // installed it is that image: the first write would erase it. Refused at
    // the gate too; this also covers a second file part in the same request.
    if (installed_) return false;
    refusal_ = check_start(program_running);
    return refusal_ == Refusal::kNone;
  }

  // The image is not acceptable.
  void refuse(Refusal refusal) { refusal_ = refusal; }

  // The device could not do its part - open the slot, write it, finalise it.
  void fail() { failed_ = true; }

  // The image is the boot partition. Sticky until the device restarts - or,
  // when no restart could be started, until it is power-cycled.
  void install(bool restart_scheduled) {
    installed_ = true;
    restart_scheduled_ = restart_scheduled;
    restarting_ = restart_scheduled;
  }

  // Between an accepted image and the restart that runs it.
  bool restart_pending() const { return installed_ && restart_scheduled_; }

  Answer respond() const {
    if (restarting_) return Answer{};
    if (installed_) return already_installed();
    if (failed_ && refusal_ == Refusal::kNone) {
      return Answer{&problem::kOtaWriteFailed,
                    "The device could not write the firmware. Nothing was changed - try again."};
    }

    // Nothing recorded means nothing arrived: an empty or missing file part.
    const Refusal refusal = refusal_ == Refusal::kNone ? Refusal::kEmptyImage : refusal_;
    // A running program clears on its own; a bad image never will.
    const ProblemType &type =
        refusal == Refusal::kProgramRunning ? problem::kProgramRunning : problem::kOtaImageRefused;
    return Answer{&type, message(refusal)};
  }

 private:
  Answer already_installed() const {
    if (restart_scheduled_) {
      return Answer{&problem::kRestartPending,
                    "A firmware update was just installed and the device is restarting into it - "
                    "wait for it to come back"};
    }
    return Answer{&problem::kRestartFailed,
                  "The firmware was installed and is the boot partition, but the restart could "
                  "not be started. Power-cycle the device to run it."};
  }

  Refusal refusal_ = Refusal::kNone;
  bool failed_ = false;
  bool restarting_ = false;
  bool installed_ = false;
  bool restart_scheduled_ = false;
};

}  // namespace rt::ota
