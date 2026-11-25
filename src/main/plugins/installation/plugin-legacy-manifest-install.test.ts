import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installPluginFromLocalPath } from './plugin-install'
import { discoverPlugins, isInvalidDiscoveredPlugin } from '../discovery/plugin-discovery'
import { findPluginManifestFile, readPluginManifestText } from '../artifacts/plugin-manifest-file'
import { legacySpellings } from '../../../shared/branding/legacy-brand-names'
import { PLUGIN_MANIFEST_FILENAME } from '../../../shared/plugins/manifest/plugin-manifest'
import { PLUGIN_DERIVED_PUBLISHER_SINCE } from '../../../shared/plugins/manifest/plugin-schema-field-docs'

const HOST = PLUGIN_DERIVED_PUBLISHER_SINCE
const roots: string[] = []
// Built from the current names so the rebrand codemod leaves the legacy spellings intact.
const LEGACY_MANIFEST_NAMES = legacySpellings(PLUGIN_MANIFEST_FILENAME)
const LEGACY_ENGINE_KEYS = legacySpellings('vshu')

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function writeLegacyThemePlugin(
  root: string,
  manifestName: string,
  engineKey: string
): Promise<void> {
  await writeFile(
    join(root, manifestName),
    JSON.stringify({
      manifestVersion: 2,
      execution: 'data',
      id: 'dusk',
      name: 'Dusk',
      version: '1.0.0',
      engines: { [engineKey]: `>=${HOST}` },
      contributes: { terminalThemes: [{ id: 'dusk', title: 'Dusk', path: 'dusk.json' }] }
    })
  )
  await writeFile(
    join(root, 'dusk.json'),
    JSON.stringify({ background: '#101010', foreground: '#f0f0f0' })
  )
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pre-rebrand plugin manifests', () => {
  it('knows one legacy manifest name and engine key per earlier brand', () => {
    expect(LEGACY_MANIFEST_NAMES).toHaveLength(2)
    expect(LEGACY_ENGINE_KEYS).toHaveLength(2)
  })

  it.each(LEGACY_MANIFEST_NAMES.map((name, index) => [name, LEGACY_ENGINE_KEYS[index]]))(
    'installs and discovers a plugin whose manifest is %s',
    async (manifestName, engineKey) => {
      const source = await tempRoot('vshu-legacy-manifest-src-')
      const pluginsDir = await tempRoot('vshu-legacy-manifest-installs-')
      await writeLegacyThemePlugin(source, manifestName, engineKey)

      const result = await installPluginFromLocalPath({
        pluginsDir,
        sourcePath: source,
        hostVersion: HOST
      })

      expect(result).toMatchObject({ ok: true, pluginKey: 'local.dusk' })
      const discovered = await discoverPlugins({
        pluginsDir,
        devPluginPaths: [],
        hostVersion: HOST
      })
      expect(
        discovered.map((plugin) =>
          isInvalidDiscoveredPlugin(plugin) ? plugin.error : plugin.pluginKey
        )
      ).toEqual(['local.dusk'])
    }
  )

  it('prefers vshu-plugin.json and keeps its text untouched', async () => {
    const root = await tempRoot('vshu-legacy-manifest-both-')
    await writeLegacyThemePlugin(root, LEGACY_MANIFEST_NAMES[0], LEGACY_ENGINE_KEYS[0])
    const current = `${JSON.stringify({ id: 'current', engines: { vshu: '>=1.0.0' } }, null, 2)}\n`
    await writeFile(join(root, PLUGIN_MANIFEST_FILENAME), current)

    expect(findPluginManifestFile(root)).toBe(join(root, PLUGIN_MANIFEST_FILENAME))
    expect(await readPluginManifestText(root)).toBe(current)
  })

  it('reads a legacy engine range as engines.vshu', async () => {
    const root = await tempRoot('vshu-legacy-manifest-engines-')
    await writeLegacyThemePlugin(root, LEGACY_MANIFEST_NAMES[1], LEGACY_ENGINE_KEYS[1])

    const manifest = JSON.parse(await readPluginManifestText(root)) as {
      engines: Record<string, string>
    }

    expect(manifest.engines).toEqual({ vshu: `>=${HOST}` })
  })

  it('still reports a missing manifest under the current name', async () => {
    const root = await tempRoot('vshu-legacy-manifest-empty-')

    expect(findPluginManifestFile(root)).toBeNull()
    await expect(
      installPluginFromLocalPath({ pluginsDir: root, sourcePath: root, hostVersion: HOST })
    ).resolves.toMatchObject({
      ok: false,
      error: `no ${PLUGIN_MANIFEST_FILENAME} found in ${root}`
    })
  })
})
