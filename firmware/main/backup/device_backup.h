#pragma once

#include <PsychicHttp.h>

// Backing up what a club has put on a board, and putting it back (#520):
// uploaded programs, uploaded clips and the hardware configuration, in one
// ZIP. The WiFi credentials are never in it.
//
// The archive's layout and every restore decision are in rt_logic/backup.h,
// where they are host-tested; this is the HTTP and flash side of them.
namespace device_backup {

// web_server's control-lock check: true to proceed, false once it has answered.
using ControlLockGuard = bool (*)(PsychicRequest *, PsychicResponse *);

// Registers GET /api/v2/backup and POST /api/v2/restore.
void register_routes(PsychicHttpServer &server, ControlLockGuard require_control_lock);

}  // namespace device_backup
