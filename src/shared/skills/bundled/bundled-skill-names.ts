import { legacySpellings, rebrandLegacyName } from '../../branding/legacy-brand-names'
import renames from './bundled-skill-renames.json'

const renamedFrom: Readonly<Record<string, readonly string[]>> = renames

/**
 * Every name an earlier build installed `name` under: its explicit renames, then each legacy-brand
 * spelling of it and of them, since the rebrand renamed every brand-prefixed bundled skill.
 * generate-skill-bundle-manifest.mjs derives each bundled source's `aliases` by the same rule.
 */
export function formerBundledSkillNames(name: string): readonly string[] {
  const renamed = renamedFrom[name] ?? []
  return [...new Set([...renamed, ...[name, ...renamed].flatMap((n) => legacySpellings(n))])]
}

function canonicalBundledSkillName(name: string): string {
  const renamed = Object.keys(renamedFrom).find((candidate) =>
    formerBundledSkillNames(candidate).includes(name)
  )
  if (renamed) {
    return renamed
  }
  const rebranded = rebrandLegacyName(name)
  return formerBundledSkillNames(rebranded).includes(name) ? rebranded : name
}

export function bundledSkillNames(name: string): readonly string[] {
  const canonical = canonicalBundledSkillName(name)
  return [...new Set([name, canonical, ...formerBundledSkillNames(canonical)])]
}

/** Older clients still match their requested spelling when paired with a newer host. */
export function requestedBundledSkillName(name: string, requested?: readonly string[]): string {
  if (!requested || requested.includes(name)) {
    return name
  }
  return formerBundledSkillNames(name).find((former) => requested.includes(former)) ?? name
}
