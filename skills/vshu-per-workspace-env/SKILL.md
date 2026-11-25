---
name: vshu-per-workspace-env
description: >-
  Set up, review, debug, or validate a Vshu per-workspace environment recipe: the
  on-demand, disposable runtime (cloud sandbox, VM, SSH host, or local container)
  Vshu creates fresh for each workspace. Use to stand up a new recipe end to end,
  fix an `environmentRecipes` entry in `vshu.yaml`, scaffold provider lifecycle
  scripts, or resolve an `vshu vm recipe doctor` failure. Use `vshu-cli` for
  ordinary worktree and workspace creation with no recipe involved.
---

# Per-Workspace Environments

This discovery stub loads the version-matched guide from the Vshu executable used for this session.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `VSHU_CLI_COMMAND` environment variable is set, use its value. Vshu exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `VSHU_DEV_REPO_ROOT`, use `vshu-dev`.
- Otherwise, on Linux outside a Vshu-managed terminal, use `vshu-ide`. Never run bare
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
VSHU skills get vshu-per-workspace-env
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
