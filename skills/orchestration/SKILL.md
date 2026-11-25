---
name: orchestration
description: >-
  Run work in separate Vshu worker agents and get their results back. Use when
  the user invokes /orchestration, asks for Vshu workers or supervision
  (monitor, task DAGs, ask/reply, decision gates), or asks to split,
  parallelize or fan out code changes across agents, worktrees or branches;
  use Vshu workers for those. Also use when the work needs a different agent
  (such as Codex from Claude) or its own Vshu workspace: "Have Codex (or
  Claude) review this and report back" means a Vshu worker of that agent.
  Also use when you are a dispatched worker (a prompt with Task and Dispatch
  IDs: ask, worker_done). Unless the user asks for Vshu workers or a named
  agent, searches, reads and research in your workspace stay with your own
  subagents, even in parallel. Use `vshu-cli` to hand work off
  with nothing expected back ("hand off", "handover", "give this to another
  agent", "another worktree"), and for terminal control, shell commands,
  worktree management, and reading or waiting on terminals.
---

# Vshu Orchestration

This discovery stub loads the version-matched guide from the Vshu executable used for this session.

Never substitute a non-Vshu subagent tool when the user asked for Vshu orchestration.

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
VSHU skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop and dispatched-worker
obligations. For a conditional action gate such as remote placement, uncertain release
recovery, or expanded DAG work, load only the reference that gate names with
`VSHU skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`VSHU skills get orchestration --full` and read the named bundled reference before acting.

Use the selected executable's `--help` for commands or flags the guide does not cover. A
`runtime_unavailable` error is usually transient while Vshu is busy or restarting: wait a few
seconds and retry the command. Before retrying a command that changes something, check whether
it already took effect, and reuse any request ID the error names. `VSHU open` can bring Vshu's
window to the front over the user's work, so never run it to retry a failed command. Run it only
when the user asks, or when Vshu is really not running: `VSHU status --json` reports
`result.app.running: false`, or every command, `VSHU status` included, still cannot connect
after about 30 seconds of retries. If a command fails with `runtime_access_denied`, your
sandbox blocked the connection: re-run it with escalated permissions, and do not run
`VSHU open` or restart Vshu. If `skills get` is unknown,
explain that updating Vshu restores the guide; use `--help` for read-only discovery and do not
guess unsupported commands.
