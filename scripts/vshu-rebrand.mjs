#!/usr/bin/env node
// Deterministic Orca/Helix -> Vshu rebrand codemod.
//
// Rewrites every tracked text file and every tracked path so the product,
// CLI, packages, env vars, identifiers and on-disk names all say "vshu".
// It is idempotent: running it on an already-rebranded tree is a no-op.
// scripts/sync-upstream.mjs runs it on each upstream (Orca) snapshot before
// merging, so upstream updates arrive already rebranded.
//
// Usage: node scripts/vshu-rebrand.mjs [repoRoot] [--dry-run] [--check]
//   --check   exit 1 if anything would change (use after a sync / in CI)

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Paths the codemod must never rewrite (content or name).
const EXCLUDED_PATHS = new Set([
  // MIT requires keeping the upstream copyright notice verbatim.
  'LICENSE',
  // These name the real upstream project on purpose.
  'scripts/vshu-rebrand.mjs',
  'scripts/vshu-rebrand.test.mjs',
  'scripts/sync-upstream.mjs',
  // Append-only ledger of shipped skill digests, keyed by the names that shipped.
  'resources/skills/released-digests.json'
])

// Path prefixes the codemod must never rewrite (content or name).
const EXCLUDED_PATH_PREFIXES = [
  // Bundled official plugins ship upstream's exact bytes: their keys must match the official
  // catalog's, so a catalog install and the bundled copy are one plugin, and
  // bundled-plugins.json pins their content hash. Vshu rebrands their names when it shows them.
  'resources/plugins/launch/stablyai.orca-',
  'resources/plugins/launch/bundled-plugins.json'
]

function isExcludedPath(rel) {
  return EXCLUDED_PATHS.has(rel) || EXCLUDED_PATH_PREFIXES.some((prefix) => rel.startsWith(prefix))
}

// Third-party names that merely contain a brand word. Swapped out before the
// rewrite and restored afterwards (normalized to the second element, or kept
// verbatim when it is null).
const PROTECTED = [
  // Explicit opt-out region, e.g. upstream attribution links in markdown.
  [/<!-- vshu-rebrand:off -->[\s\S]*?<!-- vshu-rebrand:on -->/g, null],
  // GNOME's screen reader is a different product that owns /usr/bin/orca.
  [/GNOME (?:Orca|Helix)(?=[’']s orca\b)[’']s orca\b/g, 'GNOME Orca’s orca'],
  [/GNOME (?:Orca|Helix)\b/g, 'GNOME Orca'],
  [/\/usr\/bin\/orca\b/g, '/usr/bin/orca'],
  // Upstream attribution.
  [/\bOrca \(MIT\)/g, 'Orca (MIT)'],
  // Vshu installs plugins from upstream's official and community catalogs, so those
  // repositories (and the official-org plugin repositories tests stand in with) stay verbatim.
  [/\bstablyai\\?\/orca-(?:community-plugins|plugins|multipass-recipes|secrets)\b/g, null],
  [/(?<=OFFICIAL_MARKETPLACE_REPOSITORY = ')orca-plugins(?=')/g, null],
  // Official plugin keys (stablyai.orca-*) where they name installed content: persisted
  // theme/language choices and the bundled plugin folders (resources/plugins/launch).
  [/\bplugin:stablyai\.orca-(?=[a-z0-9])/g, null],
  [/(?<=launch\/)stablyai\.orca-(?=[a-z0-9{])/g, null]
]

// Ordered: specific rules first, generic case-preserving rules last.
const RULES = [
  // GitHub orgs / repos (also regex-escaped and template forms).
  [/(?<![@\w-])stablyai(?=\\?\/(?:orca|Orca|helix|Helix|vshu|homebrew-|\$\{))/g, 'vishu6213'],
  [/\bowner: stablyai\b/g, 'owner: vishu6213'],
  [/\bmaintainer: 'stablyai'/g, "maintainer: 'Vshu Contributors'"],
  [/\bhelix-ide(?=\\?\/helix\b)/g, 'vishu6213'],
  // Bundle / app identifiers.
  [/\bcom\.stablyai\.(?:orca|helix)\b/g, 'dev.vshu.app'],
  [/\bcom\.stably\.(?:orca|helix)\b/g, 'dev.vshu'],
  // Hosted domains (onorca.dev / onhelix.dev / orca.dev / helix.dev -> vshu.dev).
  [/(?<![A-Za-z])on(?:orca|helix)(?=[.-])/g, 'vshu'],
  [/\bonOrca\.dev\b/g, 'vshu.dev'],
  // Brand glued to a lowercase prefix inside test strings.
  [/\bprefixorca\b/g, 'prefixvshu'],
  // Generic, case-preserving. Lowercase only at a word start (or after an
  // escape like \n or \b) so errorcategory / googleapiforcaller are untouched.
  [/(?:(?<![A-Za-z])|(?<=\\[a-z]))(?:orca|helix)/g, 'vshu'],
  [/(?:Orca|Helix)/g, 'Vshu'],
  [/(?<![A-Z])(?:ORCA|HELIX)/g, 'VSHU']
]

// Private-use code points never occur in source, so they make a safe fence.
const FENCE = '\uE000'
const FENCE_RE = /\uE000VSHU_PROTECTED_(\d+)\uE000/g

export function rebrandText(input) {
  let text = input
  const saved = []
  for (const [re, normalized] of PROTECTED) {
    text = text.replace(re, (match) => {
      saved.push(normalized ?? match)
      return `${FENCE}VSHU_PROTECTED_${saved.length - 1}${FENCE}`
    })
  }
  for (const [re, replacement] of RULES) {
    text = text.replace(re, replacement)
  }
  return text.replace(FENCE_RE, (_, i) => saved[Number(i)])
}

function isBinary(buf) {
  const len = Math.min(buf.length, 8192)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) {
      return true
    }
  }
  return false
}

function listTrackedFiles(repoRoot) {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 256
  })
  return out.split('\0').filter(Boolean)
}

function readRebrandableText(abs) {
  let buf
  try {
    if (fs.lstatSync(abs).isSymbolicLink()) {
      return null
    }
    buf = fs.readFileSync(abs)
  } catch {
    return null
  }
  if (isBinary(buf)) {
    return null
  }
  const text = buf.toString('utf8')
  // Skip files that are not valid UTF-8 rather than corrupting them.
  return Buffer.from(text, 'utf8').equals(buf) ? text : null
}

function planRenames(repoRoot, files, tracked) {
  const renames = []
  const collisions = []
  const targets = new Map()
  for (const rel of files) {
    const next = rebrandText(rel)
    if (next === rel) {
      continue
    }
    if (targets.has(next)) {
      collisions.push(`${targets.get(next)} and ${rel} -> ${next}`)
      continue
    }
    if (tracked.has(next)) {
      // An already-rebranded twin exists; fine only if both converge.
      const a = readRebrandableText(path.join(repoRoot, rel))
      const b = readRebrandableText(path.join(repoRoot, next))
      if (a === null || b === null || rebrandText(a) !== rebrandText(b)) {
        collisions.push(`${rel} -> ${next} (existing file differs)`)
        continue
      }
    }
    targets.set(next, rel)
    renames.push([rel, next])
  }
  if (collisions.length) {
    throw new Error(`Rename collisions:\n  ${collisions.join('\n  ')}`)
  }
  return renames
}

function applyRenames(repoRoot, renames) {
  const dirs = new Set()
  for (const [from, to] of renames) {
    const absFrom = path.join(repoRoot, from)
    const absTo = path.join(repoRoot, to)
    if (!fs.existsSync(absFrom)) {
      continue
    }
    fs.mkdirSync(path.dirname(absTo), { recursive: true })
    if (fs.existsSync(absTo)) {
      fs.rmSync(absFrom)
    } else {
      fs.renameSync(absFrom, absTo)
    }
    for (let d = path.dirname(from); d && d !== '.'; d = path.dirname(d)) {
      dirs.add(d)
    }
  }
  // Remove directories the renames emptied, deepest first.
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    const abs = path.join(repoRoot, d)
    try {
      if (fs.readdirSync(abs).length === 0) {
        fs.rmdirSync(abs)
      }
    } catch {
      // Already gone or not empty.
    }
  }
}

export function rebrandRepo(repoRoot, { dryRun = false } = {}) {
  const tracked = new Set(listTrackedFiles(repoRoot))
  const files = [...tracked].filter((f) => !isExcludedPath(f))
  const changedFiles = []
  for (const rel of files) {
    const abs = path.join(repoRoot, rel)
    const before = readRebrandableText(abs)
    if (before === null) {
      continue
    }
    const after = rebrandText(before)
    if (after !== before) {
      changedFiles.push(rel)
      if (!dryRun) {
        fs.writeFileSync(abs, after)
      }
    }
  }
  const renames = planRenames(repoRoot, files, tracked)
  if (!dryRun) {
    applyRenames(repoRoot, renames)
  }
  return { changedFiles, renames }
}

function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const dryRun = checkOnly || args.includes('--dry-run')
  const repoRoot = path.resolve(
    args.find((a) => !a.startsWith('--')) ?? path.join(import.meta.dirname, '..')
  )
  const { changedFiles, renames } = rebrandRepo(repoRoot, { dryRun })
  const prefix = dryRun ? '[dry-run] ' : ''
  console.log(
    `${prefix}vshu-rebrand: ${changedFiles.length} file contents, ${renames.length} paths`
  )
  if (checkOnly && (changedFiles.length || renames.length)) {
    for (const f of changedFiles.slice(0, 50)) {
      console.log(`  content: ${f}`)
    }
    for (const [a, b] of renames.slice(0, 50)) {
      console.log(`  rename:  ${a} -> ${b}`)
    }
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main()
}
