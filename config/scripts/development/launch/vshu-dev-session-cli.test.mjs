import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const wrapperPath = path.join(import.meta.dirname, 'vshu-dev.mjs')

describe.skipIf(process.platform === 'win32')("vshu-dev and a session's own CLI", () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vshu-dev-handoff-'))
  const cliEntry = path.join(root, 'cli-entry.cjs')
  writeFileSync(cliEntry, 'process.stdout.write("dev " + process.argv.slice(2).join(" "))', 'utf8')
  const sessionCli = path.join(root, 'session-vshu')
  writeFileSync(sessionCli, '#!/bin/sh\nprintf "session %s handoff=%s" "$*" "$VSHU_CLI_HANDOFF"\n')
  chmodSync(sessionCli, 0o755)
  const run = (env) =>
    execFileSync(process.execPath, [wrapperPath, 'connector', 'reply'], {
      env: {
        PATH: process.env.PATH,
        VSHU_DEV_CLI_ENTRY_PATH: cliEntry,
        VSHU_DEV_USER_DATA_PATH: path.join(root, 'user-data'),
        VSHU_APP_EXECUTABLE: path.join(root, 'Electron'),
        ...env
      },
      encoding: 'utf8'
    })

  it('hands off to the CLI the session names', () => {
    expect(run({ VSHU_CLI_COMMAND: sessionCli })).toBe(
      `session connector reply handoff=${sessionCli}`
    )
  })

  it('runs the dev CLI when the session names this launcher, or one that is gone', () => {
    const link = path.join(root, 'vshu-dev-link')
    symlinkSync(wrapperPath, link)
    for (const named of [wrapperPath, link, path.join(root, 'missing')]) {
      expect(run({ VSHU_CLI_COMMAND: named })).toBe('dev connector reply')
    }
  })

  it('runs the dev CLI outside a session, and after a hand-off reached it', () => {
    expect(run({})).toBe('dev connector reply')
    expect(run({ VSHU_CLI_COMMAND: sessionCli, VSHU_CLI_HANDOFF: sessionCli })).toBe(
      'dev connector reply'
    )
  })
})
