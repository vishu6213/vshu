import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createManagedCommandMatcher } from './commands/managed-hook-command-matching'
import { findManagedTomlBlocks } from './configuration/managed-toml-ownership'
import { removeLegacyBrandManagedFiles } from './legacy-brand-managed-files'
import { removeManagedDshPatch } from '../../dsh/dsh-home-patch'

// Split so the rebrand codemod leaves these pre-rebrand spellings alone.
const ORIGINAL = 'or' + 'ca'
const ORIGINAL_TITLE = 'Or' + 'ca'

describe('legacy-brand hook ownership', () => {
  it('claims hook commands that run the pre-rebrand native executable', () => {
    const isManaged = createManagedCommandMatcher('claude-hook.cmd')

    expect(
      isManaged(`C:/Users/me/.${ORIGINAL}/agent-hooks/${ORIGINAL}-agent-hook.exe claude`)
    ).toBe(true)
    expect(isManaged('C:/Users/me/.vshu/agent-hooks/vshu-agent-hook.exe claude')).toBe(true)
    expect(isManaged(`C:/tools/${ORIGINAL}-agent-hook.exe claude`)).toBe(false)
  })

  it('claims TOML blocks written under the pre-rebrand marker', () => {
    const text = [
      'model = "x"',
      `# >>> ${ORIGINAL}-managed-kimi-hooks (managed by ${ORIGINAL_TITLE}; do not edit) >>>`,
      '[[hooks]]',
      `# <<< ${ORIGINAL}-managed-kimi-hooks <<<`,
      ''
    ].join('\n')

    const blocks = findManagedTomlBlocks(text, {
      startMarker: '# >>> vshu-managed-kimi-hooks (managed by Vshu; do not edit) >>>',
      endMarker: '# <<< vshu-managed-kimi-hooks <<<'
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].terminated).toBe(true)
  })

  it('removes a DSH patch block written under the pre-rebrand marker', () => {
    const text = [
      '- user-row',
      `# >>> ${ORIGINAL}-managed-dsh-hooks (managed by ${ORIGINAL_TITLE}; do not edit) >>>`,
      '- insert:',
      `# <<< ${ORIGINAL}-managed-dsh-hooks <<<`,
      ''
    ].join('\n')

    expect(removeManagedDshPatch(text)).toEqual({ text: '- user-row\n', changed: true })
  })

  it('removes only marked pre-rebrand copies of managed files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-brand-managed-files-'))
    try {
      writeFileSync(join(dir, `${ORIGINAL}-titlebar.ts`), `// @${ORIGINAL}-managed-pi-extension\n`)
      writeFileSync(join(dir, `${ORIGINAL}-prefill.ts`), '// a user file\n')

      removeLegacyBrandManagedFiles(
        dir,
        ['vshu-titlebar.ts', 'vshu-prefill.ts'],
        '@vshu-managed-pi-extension'
      )

      expect(readdirSync(dir)).toEqual([`${ORIGINAL}-prefill.ts`])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
