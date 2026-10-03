#pragma once

#include <PsychicHttp.h>

// Firmware update over the air: the inactive app slot is written from an HTTP
// upload, verified, and made the boot partition.
//
// Rollback is the safety net and it already exists - the bootloader has
// CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE and app_main() calls
// esp_ota_mark_app_valid_cancel_rollback() once it is up. An image that boots
// but cannot get that far is rolled back to the slot this one came from, with
// no cable involved.
//
// The web app, the shipped programs and the audio are inside the app image
// (#227), so they update with it. Uploads on `userdata` are not touched.
namespace ota {

// web_server's control-lock check: true to proceed, false once it has answered.
using ControlLockGuard = bool (*)(PsychicRequest *, PsychicResponse *);

// Registers POST /api/v2/ota on `server`, behind `require_control_lock` like
// every other write.
void register_routes(PsychicHttpServer &server, ControlLockGuard require_control_lock);

// True from the first byte of an upload until it finishes or is abandoned.
// The run loop refuses to start a program while this is true: a reboot is
// moments away and a program that begins now would be cut off mid-sequence.
bool in_progress();

}  // namespace ota
