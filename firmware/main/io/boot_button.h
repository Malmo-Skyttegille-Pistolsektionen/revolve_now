// ============================================================================
//  io/boot_button.h
//  The one owner of the BOOT button (GPIO0).
// ============================================================================
#pragma once

#include <cstdint>
#include <string>

#include "config_window.h"

namespace boot_button {

// Several features want this pin, and each polling it separately would be the
// wrong shape: whichever sampled first would swallow the transition the other
// was waiting for. So one task owns the pin and classifies what it sees
// (`rt::ButtonGesture`), and features ask this module what happened.
//
//   - A short press, while the setup portal is up, commits the WiFi
//     credentials submitted just before it (#208, rt::SetupClaim).
//   - Three short presses within ten seconds open the configuration window
//     (see below).
//   - A ten-second hold is a factory reset (#222). The LED goes white after
//     three seconds to say it is counting; letting go before ten abandons it.
//     Acted on here rather than exposed as a question, unlike the two above:
//     there is nobody to ask, which is the situation the gesture exists for.
//
// Nothing here is a power-on gesture. GPIO0 is a strapping pin: held low when
// reset is released, the chip enters ROM download mode and this firmware never
// runs. There is no boot-time press to detect.
void init();

// Whether a short press happened recently, consuming it if so.
//
// Recency matters. Without it a press made for some other reason - somebody
// checking the button works, a knock in a cupboard - would authorise a
// credential submission arriving much later, from anyone in radio range. The
// press is proof that somebody was at the device *now*, so it expires.
bool consume_press();

// Whether the button is available at all. False on a build where the pin was
// never configured, so a caller can say "press the button" only when there is
// a button to press.
bool available();

// --- the configuration window ------------------------------------------------
//
// Hardware configuration, WiFi, the troubleshooting bundle and the control
// lock's presence check are guarded by a window three presses of the button
// open, not by a password. Three rather than one, unlike the setup portal
// (#208): one press is something a person does by accident, a rhythm is not.
//
// The window belongs to one client (D-52, #656). A client asks for it first and
// gets a token; three presses then open it for that token alone, or for nobody
// when more than one client is waiting (rt::ConfigWindow). Hostname is inside
// it as much as the pins are: a wrong hostname changes mDNS, so the device
// stops answering to the name everybody reaches it by.

// A condition that holds the window shut regardless of the button. The app
// sets this to "a program is running": reconfiguring the machine and operating
// it are different activities. Injected so this module knows nothing about the
// executor, and so the API, the event and every guard share one definition.
using BlockedFn = bool (*)();
void block_when(BlockedFn condition);

// Asks for the window. Returns the token to wait with - `presented` again when
// it already names a request or the open window - or empty when too many
// requests are already waiting.
std::string request_window(const std::string &presented);

struct WindowStatus {
  rt::ConfigWindow::State state;
  int32_t remaining_s;  // of the window when open, of the request when pending
};

// What the client holding `token` should be told. A run reports the holder's
// window as closed, as config_window_open() treats it. A build without a button
// reports every client as holding it.
WindowStatus window_status(const std::string &token);

// Whether a request carrying `token` may write the configuration right now:
// it holds the open window and nothing is blocking it. True for everyone on a
// build without a button, which would otherwise be unconfigurable.
bool config_window_open(const std::string &token);

// Whether `token` was granted the window by somebody at the board - proof of
// presence for the control lock (D-51). False on a build without a button,
// where nothing can be proven, and not held shut by a run: locking the device
// mid-run is reasonable, reconfiguring it is not.
bool presence_window_open(const std::string &token);

// Called whenever what the `configWindow` event says may have changed: a
// window opening, lapsing or being blocked, or a press ending in a conflict.
// `open` and `remaining_s` describe the window whoever holds it; a client
// learns whether it is theirs from window_status(). The polling task watches
// the five minutes lapse, which nothing else in the system would notice.
using WindowChangedFn = void (*)(bool open, int32_t remaining_s);
void on_window_changed(WindowChangedFn callback);

}  // namespace boot_button
