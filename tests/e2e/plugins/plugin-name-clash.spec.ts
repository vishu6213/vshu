/**
 * Invariant: two plugins that share a name, and themes that share a name, are told apart by the
 * Vshu-derived publisher in the theme picker and the plugin list.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test } from '../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import { disablePluginSystem, enableDevPlugins } from './plugin-smoke'

async function writeCatppuccinPlugin(root: string, publisher: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(
    join(root, 'vshu-plugin.json'),
    JSON.stringify({
      manifestVersion: 1,
      id: 'catppuccin',
      publisher,
      name: 'Catppuccin for Vshu',
      version: '1.0.0',
      engines: { vshu: '>=1.0.0' },
      pluginApi: 1,
      contributes: { themes: [{ id: 'mocha', title: 'Catppuccin Mocha', path: 'app.json' }] }
    })
  )
  await writeFile(
    join(root, 'app.json'),
    JSON.stringify({
      base: 'dark',
      tokens: { '--background': '#1e1e2e', '--foreground': '#cdd6f4' }
    })
  )
}

async function openSettingsPane(page: Page, pane: 'appearance' | 'plugins'): Promise<void> {
  await page.evaluate((target) => {
    const state = window.__store?.getState()
    state?.openSettingsTarget({ pane: target, repoId: null })
    state?.openSettingsPage()
  }, pane)
  await expect(page.locator(`[data-settings-section="${pane}"]`)).toBeVisible()
}

test('plugins and themes sharing a name show their publishers', async ({ vshuPage }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'vshu-name-clash-'))
  const proofDir = process.env.VSHU_NAME_CLASH_PROOF_DIR
  try {
    await writeCatppuccinPlugin(join(root, 'acme'), 'acme')
    await writeCatppuccinPlugin(join(root, 'vale-c'), 'vale-c')
    await enableDevPlugins(vshuPage, [join(root, 'acme'), join(root, 'vale-c')])

    await openSettingsPane(vshuPage, 'appearance')
    await vshuPage.getByRole('combobox', { name: 'Dark theme', exact: true }).click()
    const options = vshuPage.getByRole('option', { name: /^Catppuccin Mocha/ })
    await expect(options).toHaveCount(2)
    await vshuPage.screenshot({
      path: join(proofDir ?? testInfo.outputPath(), 'theme-picker.png')
    })
    await expect(vshuPage.getByRole('option', { name: 'Catppuccin Mocha (acme)' })).toBeVisible()
    await expect(vshuPage.getByRole('option', { name: 'Catppuccin Mocha (vale-c)' })).toBeVisible()
    await vshuPage.keyboard.press('Escape')

    await openSettingsPane(vshuPage, 'plugins')
    const section = vshuPage.locator('[data-settings-section="plugins"]')
    await section.getByRole('tab', { name: /^Installed/ }).click()
    await expect(section.getByText(/^Catppuccin for Vshu/).first()).toBeVisible()
    await vshuPage.screenshot({
      path: join(proofDir ?? testInfo.outputPath(), 'plugin-list.png')
    })
    await expect(section.getByText('Catppuccin for Vshu (acme)', { exact: true })).toBeVisible()
    await expect(section.getByText('Catppuccin for Vshu (vale-c)', { exact: true })).toBeVisible()
  } finally {
    await disablePluginSystem(vshuPage).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
