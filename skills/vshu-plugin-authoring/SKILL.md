---
name: vshu-plugin-authoring
description: >-
  Build, debug, test, and publish Vshu plugins end to end: app, terminal, and icon themes,
  syntaxes, language packs, custom editors, HTML or TSX components sidebar panels, palette
  commands and shortcuts, and Node worker commands that react to workspace and agent events.
  Use when the user asks to make, change, fix, or ship an Vshu plugin, to add a panel,
  command, theme, editor, or language to Vshu, or works in a folder with an vshu-plugin.json.
  Use `vshu-cli` only to list, enable, or disable plugins that are already installed.
---

# Vshu Plugin Authoring

This discovery stub loads the version-matched guide from the Vshu executable used for this session.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `VSHU_CLI_COMMAND` environment variable is set, use its value. Vshu exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `VSHU_DEV_REPO_ROOT`, use `vshu-dev`.
- Otherwise, on Linux outside an Vshu-managed terminal, use `vshu-ide`. Never run bare
  `vshu` there — outside Vshu's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `vshu`.

Below, `VSHU` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `VSHU` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Vshu build.

## Load the version-matched guide before running Vshu commands

```text
VSHU skills get vshu-plugin-authoring
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. A `runtime_unavailable` error is usually transient while Vshu is busy or
restarting: wait a few seconds and retry the command. Before retrying a command that changes
something, check whether it already took effect, and reuse any request ID the error names.
`VSHU open` can bring Vshu's window to the front over the user's work, so never run it to
retry a failed command. Run it only when the user asks, or when Vshu is really not running:
`VSHU status --json` reports `result.app.running: false`, or every command, `VSHU status`
included, still cannot connect after about 30 seconds of retries. If a command fails with
`runtime_access_denied`, your sandbox blocked the connection: re-run it with escalated
permissions, and do not run `VSHU open` or restart Vshu. If `skills get` is unknown, explain
that updating Vshu restores the guide; use `--help` for read-only discovery and do not guess
unsupported commands.
