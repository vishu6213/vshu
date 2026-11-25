import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type {
  ComputerActionResult,
  ComputerSnapshotResult
} from '../../../../src/shared/computer/computer-use-runtime-types'
import {
  activateFinder,
  ensureTextEditLaunched,
  findRoleIndex,
  killTextEdit
} from './computer-driver'
import { ensureVshuRuntimeLaunched, parseJsonOutput, runVshuCli } from './computer-cli-driver'
import {
  clickCapturedTextEditOpenDialog,
  doubleClickTextEditWord
} from './computer-coordinate-click-driver'

const isMac = process.platform === 'darwin'
const e2eOptIn = process.env.VSHU_COMPUTER_E2E === '1'

describe.skipIf(!isMac || !e2eOptIn)('computer-use macOS e2e (TextEdit)', () => {
  beforeAll(async () => {
    await ensureVshuRuntimeLaunched()
    await ensureTextEditLaunched()
  })

  afterAll(async () => {
    await killTextEdit()
  })

  test('click, type-text, and re-observe show inserted text', async () => {
    const before = parseJsonOutput<{ result: ComputerSnapshotResult }>(
      (await runVshuCli(['computer', 'get-app-state', '--app', 'TextEdit', '--json'])).stdout
    )
    const textTarget = findRoleIndex(
      before.result.snapshot.treeText,
      /^\s*(\d+)\s+(text entry area|text field|HTML content)(?:\s|$)/m
    )
    expect(textTarget).toBeGreaterThanOrEqual(0)

    await runVshuCli([
      'computer',
      'click',
      '--app',
      'TextEdit',
      '--element-index',
      String(textTarget)
    ])

    const marker = `vshu computer e2e ${Date.now()}`
    await runVshuCli(['computer', 'type-text', '--app', 'TextEdit', '--text', marker])

    const after = parseJsonOutput<{ result: ComputerSnapshotResult }>(
      (await runVshuCli(['computer', 'get-app-state', '--app', 'TextEdit', '--json'])).stdout
    )
    expect(after.result.snapshot.treeText).toContain(marker)
  })

  test('coordinate double-click activates a control, not just hover (STA-3433)', async () => {
    const result = await doubleClickTextEditWord()

    expect(result.action?.path).toBe('synthetic')
    expect(result.action?.verification).toMatchObject({
      state: 'unverified',
      reason: 'synthetic_input'
    })
    expect(result.replacedWord).toBe(true)
  })

  test('coordinate click reaches the captured native dialog window', async () => {
    expect(await clickCapturedTextEditOpenDialog()).toMatchObject({
      clickPath: 'synthetic',
      dialogClosed: true,
      dialogWasNew: true
    })
  })

  test('accessibility text actions work when TextEdit is not frontmost', async () => {
    const before = parseJsonOutput<{ result: ComputerSnapshotResult }>(
      (
        await runVshuCli([
          'computer',
          'get-app-state',
          '--app',
          'TextEdit',
          '--restore-window',
          '--no-screenshot',
          '--json'
        ])
      ).stdout
    )
    const textTarget = findRoleIndex(
      before.result.snapshot.treeText,
      /^\s*(\d+)\s+(text entry area|text field|HTML content)(?:\s|$)/m
    )
    expect(textTarget).toBeGreaterThanOrEqual(0)

    await runVshuCli([
      'computer',
      'click',
      '--app',
      'TextEdit',
      '--element-index',
      String(textTarget),
      '--restore-window',
      '--no-screenshot'
    ])

    await runVshuCli([
      'computer',
      'paste-text',
      '--app',
      'TextEdit',
      '--text',
      'vshu unfocused first',
      '--no-screenshot'
    ])
    await activateFinder()

    const selectAll = parseJsonOutput<{ result: ComputerActionResult }>(
      (
        await runVshuCli([
          'computer',
          'hotkey',
          '--app',
          'TextEdit',
          '--key',
          'CmdOrCtrl+A',
          '--no-screenshot',
          '--json'
        ])
      ).stdout
    )
    expect(selectAll.result.action?.actionName).toBe('AXSelectAll')
    expect(selectAll.result.action?.verification?.state).toBe('verified')

    const marker = `vshu unfocused final ${Date.now()}`
    const replacement = parseJsonOutput<{ result: ComputerActionResult }>(
      (
        await runVshuCli([
          'computer',
          'paste-text',
          '--app',
          'TextEdit',
          '--text',
          marker,
          '--no-screenshot',
          '--json'
        ])
      ).stdout
    )
    expect(replacement.result.action?.actionName).toBe('AXReplaceSelection')
    expect(replacement.result.action?.verification).toEqual({
      state: 'verified',
      property: 'focusedText'
    })

    const after = parseJsonOutput<{ result: ComputerSnapshotResult }>(
      (
        await runVshuCli([
          'computer',
          'get-app-state',
          '--app',
          'TextEdit',
          '--no-screenshot',
          '--json'
        ])
      ).stdout
    )
    expect(after.result.snapshot.treeText).toContain(marker)
    expect(after.result.snapshot.treeText).not.toContain('vshu unfocused first')
  })
})
