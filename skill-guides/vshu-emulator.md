---
name: vshu-emulator
description: >-
  iOS Simulator control from inside Vshu, with the live device view in Vshu's
  emulator pane. Use when driving a booted Apple Simulator on macOS: taps,
  gestures, typing, hardware buttons, rotation, and the accessibility tree, or
  when an iOS change needs simulator evidence. For an Android device or emulator
  use the Android emulator skill; build and install the app with xcodebuild or
  simctl first.
license: Apache-2.0
---

# Vshu Emulator (iOS)

`VSHU` is a placeholder for the executable you resolved in the stub; substitute it before running.

## Command surface

`VSHU emulator --help` lists the wrapped verbs. Anything else goes through
`VSHU emulator exec --command "<serve-sim command>"`, which forwards the string to serve-sim
unvalidated with the active device injected.

`install`, `launch`, `permissions`, and `logcat` are Android-only and fail against an iOS
device with `emulator_unsupported`. `tap`, `type`, `gesture`, `button`, `rotate`, `ax`, and
`exec` work on both backends.

Commands drive devices on the host that runs the Vshu runtime. Simulators need that host to
be a Mac, so a Linux `vshu serve` or SSH host can drive only Android devices.

## Prerequisites

- macOS with the Xcode Command Line Tools (`xcrun --version`).
- A booted simulator (`xcrun simctl list devices booted`), or let `attach` boot one.
- An active session for the worktree before any input verb: run `VSHU emulator attach` or
  open the emulator pane.
- In a `pnpm dev` checkout, run `pnpm build:cli` before the first emulator command so the
  dev CLI shim reaches this worktree's runtime instead of a packaged install.

Vshu reports a clear error when the host is missing macOS or the Xcode tools.

## Operations

Use `--json` for agent-driven calls. Unqualified commands target the worktree's active
device.

| Goal                     | Command                                                     | Constraint                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List worktree's sessions | `VSHU emulator list --json`                                 | The worktree's attached sessions, iOS and Android; `--worktree all` lists every worktree's. Use a row's `deviceUdid` for `--device`.                                  |
| List devices everywhere  | `VSHU emulator devices --json`                              | Every backend's devices with a platform column, booted and shutdown.                                                                                                  |
| Attach / make active     | `VSHU emulator attach "iPhone 16 Pro" --json`               | Starts the helper if needed and makes the device active for the worktree. `--focus` switches the UI; it does not by default.                                          |
| Single tap               | `VSHU emulator tap <x> <y> --json`                          | Normalized 0..1 coordinates.                                                                                                                                          |
| Multi-step gesture       | `VSHU emulator gesture '<json>' --json`                     | Begin/move/end points. Use `tap` for a single tap.                                                                                                                    |
| Type text                | `VSHU emulator type "text" --json`                          | US-ASCII only.                                                                                                                                                        |
| Hardware button          | `VSHU emulator button home --json`                          | `home` and `side_button` are documented by the CLI spec; other names such as `swipe_home`, `app_switcher`, `lock`, and `siri` are forwarded to serve-sim unvalidated. |
| Rotate device            | `VSHU emulator rotate landscape_left --json`                | The orientation persists for subsequent gestures.                                                                                                                     |
| Accessibility tree       | `VSHU emulator ax --json`                                   | serve-sim node tree, capped at 500 nodes, frames normalized 0..1 with a top-left origin. Needs an active session.                                                     |
| Raw passthrough          | `VSHU emulator exec --command "ca-debug blended on" --json` | serve-sim subcommand string, without a `serve-sim` prefix.                                                                                                            |
| Stop the helper          | `VSHU emulator kill --json`                                 | Leaves the device booted.                                                                                                                                             |
| Stop and power off       | `VSHU emulator shutdown --json`                             | Stops the helper and shuts the simulator device down.                                                                                                                 |

## Targeting

`attach`, or opening the emulator pane, makes one device active per worktree, and unqualified
commands target it. Pass a selector only to override that or reach a second device. With no
active session an unqualified command fails with `emulator_no_active`; attach or open the pane
and retry.

- `--device "iPhone 16 Pro"` or `--device <udid>`, from `list` or `devices`.
  `--emulator <id>` is an alternative spelling: the bridge resolves both through the same lookup. These
  selectors apply to the action verbs; `list` and `devices` take only `--worktree`, and
  `attach` names its device as a positional argument.
- `--worktree id:<fullWorktreeId>` or `--worktree active`. The full id is the exact
  `<repo-id>::<path>` value returned by `VSHU worktree list --json`; a bare repo id is not
  valid here.
- `--worktree all` drops worktree scoping on every verb, not only on listing, so a mutating
  command passed `all` runs unscoped. Use it only for listing.

## Constraints

- All coordinates are normalized 0..1 with a top-left origin, never pixels. Tap an `ax`
  element at its frame center: `x + width / 2`, `y + height / 2`.
- Prefer `tap` over `gesture` for a single tap. A separate gesture begin/end pair can be
  interpreted as a long press because of WebSocket overhead; `tap` sends the quick sequence.
- `type` sends US-ASCII only, and unsupported characters error rather than degrading.
- The pane and the CLI share one stream and one helper, so closing the pane can stop the
  stream.
- Run `kill` when you are done. A helper left running holds the device until Vshu quits.
- The iOS backend drives private simulator APIs, so an Xcode update can change its behavior.
- While Xcode's Device Hub is running, the simulator drops Vshu's touch and keyboard input, so
  `tap`, `type`, and `gesture` fail with `emulator_input_blocked`. Quit Device Hub, which shuts
  the simulator down, then attach again. If Device Hub must stay open, run
  `xcrun simctl spawn <udid> notifyutil -s com.apple.coredevice.dtuhidd.active 0` and
  `xcrun simctl spawn <udid> launchctl kickstart -k system/com.apple.backboardd` (this closes
  running apps), then `kill` and attach again.

## Examples

```text
VSHU emulator list --json
VSHU emulator attach "iPhone 16 Pro" --json
VSHU emulator tap 0.5 0.8 --json
VSHU emulator type "user@example.com" --json
VSHU emulator button home --json
VSHU emulator ax --json
VSHU emulator exec --command "ca-debug blended on" --json
VSHU emulator kill --device "iPhone 16 Pro" --json
```

See also: `vshu-emulator-android` for Android devices, `vshu-cli` for terminals, worktrees,
and the built-in browser, and `vshu-computer-use` for desktop UI outside the simulator.
