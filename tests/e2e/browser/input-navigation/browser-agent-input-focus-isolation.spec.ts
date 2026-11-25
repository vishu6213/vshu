/**
 * Agent browser input must reach its page without touching the user's keyboard focus (#20595).
 * Runs hidden; browser-agent-input-focus-isolation-native.spec.ts repeats it in a visible window.
 */

import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  evalInPage,
  openBackgroundProbeTab,
  readProperty,
  rpc,
  startProbeServer
} from './browser-agent-focus-scenarios'
import { runAgentInputDuringUserCompositionScenario } from './browser-agent-composition-scenario'

import { getActiveTabId } from '../../desktop/renderer-probes/store'

test('page-bound input stays out of chat drafts across hidden tabs and stale targets', async ({
  vshuPage
}) => {
  const server = await startProbeServer()
  try {
    const first = await openBackgroundProbeTab(vshuPage, server.url)
    const second = await openBackgroundProbeTab(vshuPage, server.url)
    await vshuPage.evaluate(() => {
      const draft = document.createElement('textarea')
      draft.id = 'browser-target-chat-draft'
      draft.value = 'Unsent human draft'
      document.body.append(draft)
      draft.focus()
    })
    const draft = vshuPage.locator('#browser-target-chat-draft')
    await rpc(vshuPage, 'browser.click', { page: first, element: '#notes' })
    await draft.focus()
    await rpc(vshuPage, 'browser.tabSwitch', { page: second })
    await evalInPage(vshuPage, second, 'document.getElementById("notes").focus()')

    await Promise.all([
      rpc(vshuPage, 'browser.keyboardInsertText', { page: first, text: 'First line\nSecond 🙏' }),
      rpc(vshuPage, 'browser.keyboardInsertText', { page: second, text: 'Other\ntab' }),
      draft.focus()
    ])
    await rpc(vshuPage, 'browser.type', { page: first, input: '!' })
    await rpc(vshuPage, 'browser.keypress', { page: second, key: 'End' })
    await rpc(vshuPage, 'browser.type', { page: second, input: '?' })
    expect(await evalInPage(vshuPage, first, 'document.getElementById("notes").value')).toBe(
      'First line\nSecond 🙏!'
    )
    expect(await evalInPage(vshuPage, second, 'document.getElementById("notes").value')).toBe(
      'Other\ntab?'
    )
    await expect(draft).toHaveValue('Unsent human draft')

    await rpc(vshuPage, 'browser.tabClose', { page: first })
    const terminalTab = await getActiveTabId(vshuPage)
    for (const command of [
      { method: 'browser.keyboardInsertText', params: { page: first, text: 'Stale insert' } },
      { method: 'browser.type', params: { page: 'missing-browser-page', input: 'Missing type' } },
      { method: 'browser.click', params: { page: terminalTab, element: 'textarea' } },
      { method: 'browser.keypress', params: { page: first, key: 'Enter' } }
    ]) {
      const response = await vshuPage.evaluate(
        (request) => window.api.runtime.call(request),
        command
      )
      expect(readProperty(response, 'ok')).toBe(false)
      expect(readProperty(readProperty(response, 'error'), 'code')).toBe('browser_tab_not_found')
    }
    await expect(draft).toHaveValue('Unsent human draft')
    expect(await evalInPage(vshuPage, second, 'document.getElementById("notes").value')).toBe(
      'Other\ntab?'
    )
  } finally {
    await server.close()
  }
})

test('text insertion needs a focused page target and never crashes or wedges the tab', async ({
  vshuPage
}) => {
  // Waits out a deliberately busy page (6 s) on top of tab startup and agent-browser round trips.
  test.setTimeout(120_000)
  const server = await startProbeServer()
  try {
    const pageId = await openBackgroundProbeTab(vshuPage, server.url)
    const insert = async (text: string): Promise<unknown> =>
      vshuPage.evaluate((request) => window.api.runtime.call(request), {
        method: 'browser.keyboardInsertText',
        params: { page: pageId, text }
      })
    const expectRefused = (response: unknown): void => {
      expect(readProperty(response, 'ok')).toBe(false)
      expect(JSON.stringify(readProperty(response, 'error'))).toContain('no focused element')
    }

    // A tab nobody focused has no frame to receive native text; Electron crashes if asked anyway.
    expectRefused(await insert('Fresh\ntab'))
    expect(await evalInPage(vshuPage, pageId, 'document.getElementById("notes").value')).toBe('')

    await expect
      .poll(() => evalInPage(vshuPage, pageId, 'String(window.__frameReady)'))
      .toBe('true')
    await evalInPage(vshuPage, pageId, `document.getElementById('frame').focus()`)
    await rpc(vshuPage, 'browser.keypress', { page: pageId, key: 'Z' })
    await rpc(vshuPage, 'browser.keyboardInsertText', { page: pageId, text: 'Cross site 🙏' })
    await expect
      .poll(() => evalInPage(vshuPage, pageId, 'window.__frameValue'))
      .toBe('ZCross site 🙏')

    // A busy page cannot confirm where focus is; once it recovers, input must flow again.
    await evalInPage(
      vshuPage,
      pageId,
      'setTimeout(() => { const end = Date.now() + 6000; while (Date.now() < end) {} }, 0); "busy"'
    )
    expect(readProperty(await insert('Busy'), 'ok')).toBe(false)
    await expect
      .poll(() => evalInPage(vshuPage, pageId, '"responsive"'), { timeout: 20_000 })
      .toBe('responsive')
    await rpc(vshuPage, 'browser.keyboardInsertText', { page: pageId, text: ' ok' })
    await expect
      .poll(() => evalInPage(vshuPage, pageId, 'window.__frameValue'))
      .toBe('ZCross site 🙏 ok')
  } finally {
    await server.close()
  }
})

test('agent input that moves page focus is refused during the user’s IME composition', async ({
  vshuPage
}) => {
  await runAgentInputDuringUserCompositionScenario(vshuPage)
})
