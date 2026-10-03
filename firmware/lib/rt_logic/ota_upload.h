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
    refusal_ = Refusal::kNone;

    // Ahead of the multipart check: the contract promises every upload this
    // answer until the power cycle.
    if (awaiting_power_cycle_) return restart_failed();
    if (!multipart) {
      return Answer{&problem::kUploadMissingFile,
                    "Expected a multipart/form-data body with the image in a file part"};
    }
    return std::nullopt;
  }

  // The first chunk. False means write nothing.
  bool begin(bool program_running) {
    // Already refused at the gate; checked again at the write because the
    // inactive slot is now the boot partition, and the first write erases it.
    if (awaiting_power_cycle_) return false;
    refusal_ = check_start(program_running);
    return refusal_ == Refusal::kNone;
  }

  // The image landed and check_image said no.
  void refuse(Refusal refusal) { refusal_ = refusal; }

  // The image is the boot partition. Sticky when no restart could be started:
  // only a power cycle clears it.
  void installed(bool restart_scheduled) {
    restarting_ = restart_scheduled;
    if (!restart_scheduled) awaiting_power_cycle_ = true;
  }

  Answer respond() const {
    if (restarting_) return Answer{};
    if (awaiting_power_cycle_) return restart_failed();

    // Nothing recorded means nothing was written: an empty or missing file
    // part, or a write that failed before an image could be checked.
    const Refusal refusal = refusal_ == Refusal::kNone ? Refusal::kEmptyImage : refusal_;
    // A running program clears on its own; a bad image never will.
    const ProblemType &type =
        refusal == Refusal::kProgramRunning ? problem::kProgramRunning : problem::kOtaImageRefused;
    return Answer{&type, message(refusal)};
  }

 private:
  static Answer restart_failed() {
    return Answer{&problem::kRestartFailed,
                  "The firmware was installed and is the boot partition, but the restart could "
                  "not be started. Power-cycle the device to run it."};
  }

  Refusal refusal_ = Refusal::kNone;
  bool restarting_ = false;
  bool awaiting_power_cycle_ = false;
};

}  // namespace rt::ota
