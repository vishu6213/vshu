import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ORIGINAL_BRAND_NAME } from '../../../shared/branding/legacy-brand-names'
import { bundledSkillInstallAction } from '../../../shared/skills/bundled/bundled-skill-summary'
import { bundledSkillNames } from '../../../shared/skills/bundled/bundled-skill-names'
import { bundledSkillDiscoveryName } from '../discovery/bundled-skill-discovery-name'
import { bundledSkillTextDigest, classifyBundledSkillPath } from './bundled-skill-classification'
import { nativeBundledSkillFilesystem } from './bundled-skill-filesystem'
import { previewBundledSkillInstall } from './bundled-skill-installation'
import { BUNDLED_SKILL_SOURCES } from './bundled-skill-sources'
import {
  makeSkillHome,
  previewAndInstall,
  removeSkillHomes,
  serviceInput,
  snapshot,
  writeCopy
} from './testing/bundled-skill-home'

const NAME = 'vshu-cli'
// Assembled so the rebrand codemod leaves the name the pre-rebrand build installed.
const LEGACY = `${ORIGINAL_BRAND_NAME}-cli`
// The released SKILL.md that build shipped; the opt-out fence keeps the codemod off its bytes.
const FIXTURE = join(import.meta.dirname, 'legacy-brand-cli-before-rebrand.skill-md.txt')
const FIXTURE_FENCE = /^<!-- vshu-rebrand:off -->\r?\n([\s\S]*)<!-- vshu-rebrand:on -->\r?\n?$/u
const LEDGER = join(import.meta.dirname, '../../../../resources/skills/released-digests.json')
const RELEASED_DIGEST = 'b381a507009e67774d9496eee5bab0c96cbcae706978f172e0aaa80449acf4a7'

async function readReleasedLegacyCopy(): Promise<string> {
  const released = FIXTURE_FENCE.exec(await readFile(FIXTURE, 'utf8'))?.[1]
  if (released === undefined) {
    throw new Error('The released legacy copy must stay inside the rebrand opt-out fence')
  }
  return released
}

function currentSource() {
  const source = BUNDLED_SKILL_SOURCES.find((skill) => skill.name === NAME)
  if (!source) {
    throw new Error('Canonical skill is missing')
  }
  return source
}

afterEach(removeSkillHomes)

describe('legacy-brand bundled skill names', () => {
  it('recognises an unmodified released legacy copy as a former copy of the current skill', async () => {
    const text = await readReleasedLegacyCopy()
    const source = currentSource()
    const ledger = JSON.parse(await readFile(LEDGER, 'utf8')) as {
      skills: Record<string, string[]>
    }
    expect(bundledSkillTextDigest(Buffer.from(text, 'utf8'))).toBe(RELEASED_DIGEST)
    expect(ledger.skills[LEGACY]).toContain(RELEASED_DIGEST)
    expect(source.aliases).toContain(LEGACY)
    expect(source.releasedDigests).toContain(RELEASED_DIGEST)
    expect(bundledSkillNames(LEGACY)).toContain(NAME)
    expect(bundledSkillNames(NAME)).toContain(LEGACY)
    expect(bundledSkillDiscoveryName(LEGACY, text)).toBe(NAME)

    const home = await makeSkillHome()
    const legacy = join(dirname(home.claude), LEGACY)
    await writeCopy(legacy, text)
    const classified = await classifyBundledSkillPath(
      nativeBundledSkillFilesystem,
      legacy,
      source,
      bundledSkillTextDigest(Buffer.from(source.text, 'utf8'))
    )
    expect(classified.folderClass).toBe('released')
  })

  it('replaces a released legacy agent copy with the current skill', async () => {
    const home = await makeSkillHome()
    const legacy = join(dirname(home.claude), LEGACY)
    await writeCopy(legacy, await readReleasedLegacyCopy())
    const input = {
      ...serviceInput(home, { installedOnly: true }),
      sources: BUNDLED_SKILL_SOURCES,
      names: [NAME]
    }

    await previewAndInstall(input)

    expect(await readFile(join(dirname(home.claude), NAME, 'SKILL.md'), 'utf8')).toBe(
      currentSource().text
    )
    expect(await snapshot(legacy)).toBe('missing')
    expect(bundledSkillInstallAction(await previewBundledSkillInstall(input))).toEqual({
      kind: 'none'
    })
  })

  it('leaves a modified legacy copy in place for the user to resolve', async () => {
    const home = await makeSkillHome()
    const legacy = join(dirname(home.claude), LEGACY)
    await writeCopy(legacy, `${await readReleasedLegacyCopy()}\nMy own notes.\n`)
    const plan = await previewBundledSkillInstall({
      ...serviceInput(home, { installedOnly: true }),
      sources: BUNDLED_SKILL_SOURCES,
      names: [NAME]
    })
    const ops = plan.skills.flatMap((skill) => skill.ops)
    expect(ops.find((op) => op.path === legacy)).toMatchObject({ kind: 'leave', reason: 'edited' })
    expect(ops.flatMap((op) => op.previous ?? []).map((previous) => previous.path)).not.toContain(
      legacy
    )
  })

  it('still flags a released legacy copy Vshu cannot retire beside the current skill', async () => {
    const home = await makeSkillHome()
    await writeCopy(join(dirname(home.claude), LEGACY), await readReleasedLegacyCopy())
    await writeCopy(join(dirname(home.claude), NAME), currentSource().text)
    const plan = await previewBundledSkillInstall({
      ...serviceInput(home, {
        filesystem: { ...nativeBundledSkillFilesystem, canWrite: async () => false }
      }),
      sources: BUNDLED_SKILL_SOURCES,
      names: [NAME]
    })
    expect(bundledSkillInstallAction(plan)).toEqual({ kind: 'attention' })
  })
})
