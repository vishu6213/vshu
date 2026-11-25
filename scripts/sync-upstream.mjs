#!/usr/bin/env node
// Sync Vshu with upstream Orca (https://github.com/stablyai/orca, MIT, Lovecast Inc.).
//
// 1. Ensures the `upstream` remote is stablyai/orca and fetches its main branch (never its
//    tags: upstream release tags pushed to the Vshu repo would show up as Vshu releases).
// 2. Checks out upstream/main in a temporary worktree and runs this branch's
//    scripts/vshu-rebrand.mjs on it, pins Vshu's own package.json identity fields (version,
//    description, author, homepage) so upstream version bumps never conflict, then removes
//    the worktree.
// 3. Commits the rebranded snapshot onto the local branch `upstream-vshu`, one linear commit
//    per sync on top of the previous one, so a merge only brings in what changed upstream
//    since the last sync.
// 4. Prints how to merge, or with --merge runs a normal `git merge upstream-vshu` (never
//    -X ours, which silently drops upstream changes) and then:
//    - keeps Vshu's version of every KEEP_OURS path (logo, icons, brand assets, README,
//      LICENSE): if upstream touched one, this branch's copy is restored, conflict or not.
//      .gitattributes marks the same paths `merge=ours`; this script registers that driver
//      (`git config merge.ours.driver true`) so plain `git merge` honours it too.
//    - drops what upstream adds under DROP_UPSTREAM (its CI workflows, CODEOWNERS): they
//      need upstream's secrets and runners and would only fail on the Vshu repo.
//    - commits the merge when nothing else conflicts, regenerates the brand assets with
//      scripts/apply-vshu-branding.mjs (committing any change), and runs
//      `vshu-rebrand.mjs --check`.
//    Conflicts in other files are left for you: resolve them, commit, then run
//    `node scripts/apply-vshu-branding.mjs` and `pnpm rebrand:check` (update-vshu.bat does).
//
// First sync: if HEAD shares history with upstream, the first snapshot is parented on
// merge-base(HEAD, upstream/main). If not (Vshu began as a squashed "forked from Orca"
// commit), pass --fork-point <upstream sha Vshu was forked from>: the rebranded fork point
// becomes the root of upstream-vshu, and before the first merge it is recorded on the
// current branch with `git merge -s ours --allow-unrelated-histories`. That merge changes
// no files (HEAD already contains the fork point); it gives later merges the right common
// ancestor, so every upstream change after the fork point comes through normally.
//
// Usage: node scripts/sync-upstream.mjs [--merge | --snapshot-only | --dry-run]
//                                       [--no-fetch] [--no-branding] [--fork-point <sha>]
// --snapshot-only  only updates upstream-vshu (allowed with uncommitted changes).
// --dry-run        builds the rebranded snapshot and reports what it would change; moves no
//                  branch and touches no file of the checkout.
// --no-branding    skip scripts/apply-vshu-branding.mjs after a merge.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

export const UPSTREAM_REMOTE = 'upstream'
export const UPSTREAM_URL = 'https://github.com/stablyai/orca.git'
export const UPSTREAM_BRANCH = 'main'
export const SNAPSHOT_BRANCH = 'upstream-vshu'
const TRAILER = 'Upstream-Commit'
const FLAGS = new Set([
  '--merge',
  '--snapshot-only',
  '--dry-run',
  '--no-fetch',
  '--no-branding',
  '--help',
  '-h'
])

/**
 * Vshu's copy always wins for these paths (branding, logo, icons, docs that are Vshu's own).
 * Keep in sync with the `merge=ours` block in .gitattributes (sync-upstream.test.mjs checks).
 * A file upstream adds under one of these paths is kept, with a warning to rebrand it.
 */
export const KEEP_OURS = [
  'README.md',
  'RELEASING.md',
  'LICENSE',
  'resources/logo.svg',
  'resources/icon.png',
  'resources/icon-dev.png',
  'resources/icon-dev-mac.png',
  'resources/build/icon.*',
  'resources/icon-source/**',
  'resources/branding/**',
  'resources/app-icons/**',
  'resources/tray/**',
  'mobile/assets/**',
  'src/renderer/src/assets/vshu-logo.*',
  'docs/site/public/docs/logo.svg',
  'docs/site/public/docs/favicon.ico'
]

/** Upstream-only infrastructure: Vshu keeps its own files here and drops upstream's. */
export const DROP_UPSTREAM = ['.github/workflows/**', '.github/CODEOWNERS']

/** package.json fields that stay Vshu's, so upstream release bumps never conflict. */
export const PINNED_PACKAGE_FIELDS = ['version', 'description', 'author', 'homepage', 'productName']

export function parseArgs(argv) {
  const opts = {
    merge: false,
    snapshotOnly: false,
    dryRun: false,
    fetch: true,
    branding: true,
    help: false,
    forkPoint: null
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--fork-point' || arg.startsWith('--fork-point=')) {
      opts.forkPoint = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i]
      if (!opts.forkPoint) {
        throw new Error('--fork-point needs an upstream commit')
      }
    } else if (!FLAGS.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  opts.merge = argv.includes('--merge')
  opts.snapshotOnly = argv.includes('--snapshot-only')
  opts.dryRun = argv.includes('--dry-run')
  opts.fetch = !argv.includes('--no-fetch')
  opts.branding = !argv.includes('--no-branding')
  opts.help = argv.includes('--help') || argv.includes('-h')
  if ([opts.merge, opts.snapshotOnly, opts.dryRun].filter(Boolean).length > 1) {
    throw new Error('--merge, --snapshot-only and --dry-run are mutually exclusive')
  }
  return opts
}

/** True when a remote URL (https or ssh form) names github.com/stablyai/orca. */
export function isUpstreamUrl(url) {
  return /github\.com[/:]stablyai\/orca(?:\.git)?\/?$/i.test(url.trim())
}

export function buildCommitMessage(upstreamSha, upstreamSubject, { forkPoint = false } = {}) {
  const kind = forkPoint ? 'fork point' : 'snapshot'
  return [
    `chore(sync): vshu ${kind} @${upstreamSha.slice(0, 12)}`,
    '',
    `Sync details: ${upstreamSubject}`,
    'Generated by scripts/sync-upstream.mjs with scripts/vshu-rebrand.mjs.',
    '',
    `${TRAILER}: ${upstreamSha}`
  ].join('\n')
}

/** Reads the upstream sha a snapshot commit was built from, or null. */
export function parseUpstreamCommit(message) {
  const match = new RegExp(`^${TRAILER}: ([0-9a-f]{40})$`, 'm').exec(message)
  return match ? match[1] : null
}

/** Minimal gitignore-style glob: `**` spans directories, `*` stays within one. */
export function globToRegExp(pattern) {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*' && pattern[i + 1] === '*') {
      source += '.*'
      i++
    } else if (char === '*') {
      source += '[^/]*'
    } else {
      source += /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char
    }
  }
  return new RegExp(`^${source}$`)
}

export function matchesAny(file, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(file))
}

/** Copies Vshu's single-line top-level string fields over upstream's, keeping the layout. */
export function pinPackageFields(upstreamText, oursText, fields = PINNED_PACKAGE_FIELDS) {
  let result = upstreamText
  for (const field of fields) {
    const line = new RegExp(`^(  "${field}": )"(?:[^"\\\\]|\\\\.)*"(,?\\r?)$`, 'm')
    const ours = line.exec(oursText)
    if (ours && line.test(result)) {
      const value = ours[0].slice(ours[1].length).replace(/,?\r?$/, '')
      result = result.replace(line, (_match, prefix, suffix) => `${prefix}${value}${suffix}`)
    }
  }
  return result
}

/**
 * Decides what happens to a path the merge touched: 'ours' restores this branch's copy,
 * 'remove' deletes it, 'warn' keeps upstream's new file but flags it, null leaves it to git.
 */
export function classifyMergedPath(file, { inHead, unmerged }) {
  const drop = matchesAny(file, DROP_UPSTREAM)
  if (!drop && !matchesAny(file, KEEP_OURS)) {
    return null
  }
  if (inHead) {
    return 'ours'
  }
  // Not on this branch: either Vshu deleted it (upstream then edited it: unmerged) or
  // upstream added it.
  return drop || unmerged ? 'remove' : 'warn'
}

function git(args, cwd, { allowFail = false, inherit = false } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0 && !allowFail) {
    const detail = inherit ? '' : `\n${(result.stderr || result.stdout || '').trim()}`
    throw new Error(`git ${args.join(' ')} failed (exit ${result.status})${detail}`)
  }
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

const short = (sha) => sha.slice(0, 12)
const step = (message) => console.log(`\n==> ${message}`)
const lines = (text) => text.split('\n').filter(Boolean)

function ensureUpstreamRemote(repoRoot) {
  const current = git(['remote', 'get-url', UPSTREAM_REMOTE], repoRoot, { allowFail: true })
  if (!current.ok) {
    console.log(`Adding remote ${UPSTREAM_REMOTE} -> ${UPSTREAM_URL}`)
    git(['remote', 'add', UPSTREAM_REMOTE, UPSTREAM_URL], repoRoot)
  } else if (!isUpstreamUrl(current.out)) {
    console.log(`Remote ${UPSTREAM_REMOTE} was ${current.out}; resetting to ${UPSTREAM_URL}`)
    git(['remote', 'set-url', UPSTREAM_REMOTE, UPSTREAM_URL], repoRoot)
  }
  // Upstream's release tags must never reach the Vshu repo (see the header).
  git(['config', `remote.${UPSTREAM_REMOTE}.tagOpt`, '--no-tags'], repoRoot)
}

/** Registers the `ours` merge driver that .gitattributes assigns to the KEEP_OURS paths. */
function ensureOursMergeDriver(repoRoot) {
  git(['config', 'merge.ours.name', 'Keep the Vshu version (scripts/sync-upstream.mjs)'], repoRoot)
  git(['config', 'merge.ours.driver', 'true'], repoRoot)
}

function rebrandedTree(repoRoot, upstreamSha) {
  step(`Rebranding upstream ${short(upstreamSha)} in a temporary worktree`)
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'vshu-sync-'))
  const worktree = path.join(tmpParent, 'upstream')
  const codemod = path.join(repoRoot, 'scripts', 'vshu-rebrand.mjs')
  try {
    git(['worktree', 'add', '--detach', worktree, upstreamSha], repoRoot, { inherit: true })
    execFileSync(process.execPath, [codemod, worktree], { cwd: worktree, stdio: 'inherit' })
    const ours = git(['show', 'HEAD:package.json'], repoRoot, { allowFail: true })
    const packageFile = path.join(worktree, 'package.json')
    if (ours.ok && fs.existsSync(packageFile)) {
      const upstream = fs.readFileSync(packageFile, 'utf8')
      fs.writeFileSync(packageFile, pinPackageFields(upstream, ours.out))
    }
    git(['add', '--all'], worktree)
    return git(['write-tree'], worktree).out
  } finally {
    git(['worktree', 'remove', '--force', worktree], repoRoot, { allowFail: true })
    fs.rmSync(tmpParent, { recursive: true, force: true })
    git(['worktree', 'prune'], repoRoot, { allowFail: true })
  }
}

function commitSnapshot(repoRoot, upstreamSha, parent, options) {
  const tree = rebrandedTree(repoRoot, upstreamSha)
  if (parent && git(['rev-parse', `${parent}^{tree}`], repoRoot).out === tree) {
    console.log('Rebranded snapshot is identical to the previous one; nothing to commit.')
    return parent
  }
  const subject = git(['log', '-1', '--format=%s', upstreamSha], repoRoot).out
  const args = ['commit-tree', tree, '-m', buildCommitMessage(upstreamSha, subject, options)]
  if (parent) {
    args.push('-p', parent)
  }
  const commit = git(args, repoRoot).out
  const stat = git(['show', '--shortstat', '--format=', commit], repoRoot).out
  console.log(`Committed ${short(commit)} (${stat || 'no file changes'})`)
  return commit
}

function snapshotTip(repoRoot) {
  return git(
    ['rev-parse', '--verify', '--quiet', `refs/heads/${SNAPSHOT_BRANCH}^{commit}`],
    repoRoot,
    {
      allowFail: true
    }
  )
}

/** Builds the snapshot tree without moving any ref, and reports what a sync would bring. */
function dryRun(repoRoot, upstreamSha) {
  const tip = snapshotTip(repoRoot)
  const tree = rebrandedTree(repoRoot, upstreamSha)
  step('Dry run: nothing was committed')
  if (tip.ok) {
    const stat = git(['diff', '--shortstat', tip.out, tree], repoRoot).out
    console.log(`Since the last snapshot (${short(tip.out)}): ${stat || 'no changes'}`)
    const changed = lines(git(['diff', '--name-only', tip.out, tree], repoRoot).out)
    const kept = changed.filter((file) => matchesAny(file, KEEP_OURS))
    const dropped = changed.filter((file) => matchesAny(file, DROP_UPSTREAM))
    console.log(`Branded paths upstream changed (Vshu's copy will be kept): ${kept.length}`)
    for (const file of kept.slice(0, 20)) {
      console.log(`  ${file}`)
    }
    console.log(`Upstream CI files that will be dropped: ${dropped.length}`)
  } else {
    console.log(`No ${SNAPSHOT_BRANCH} yet; the first sync would create it.`)
  }
  const stat = git(['diff', '--shortstat', 'HEAD', tree], repoRoot).out
  console.log(`Snapshot vs HEAD (includes all Vshu customizations): ${stat || 'identical'}`)
}

/** Updates upstream-vshu to the rebranded upstream snapshot. */
function updateSnapshotBranch(repoRoot, upstreamSha, forkPoint) {
  const ref = `refs/heads/${SNAPSHOT_BRANCH}`
  const tip = snapshotTip(repoRoot)
  if (tip.ok) {
    const message = git(['log', '-1', '--format=%B', tip.out], repoRoot).out
    if (parseUpstreamCommit(message) === upstreamSha) {
      console.log(`${SNAPSHOT_BRANCH} already has upstream ${short(upstreamSha)}.`)
      return
    }
  }

  let parent = tip.ok ? tip.out : null
  if (!parent) {
    const base = git(['merge-base', 'HEAD', upstreamSha], repoRoot, { allowFail: true })
    if (base.ok) {
      parent = base.out
      console.log(`First sync: parenting ${SNAPSHOT_BRANCH} on merge-base ${short(parent)}.`)
    } else if (forkPoint) {
      const sha = git(['rev-parse', '--verify', `${forkPoint}^{commit}`], repoRoot).out
      console.log(`First sync: ${SNAPSHOT_BRANCH} starts at the fork point ${short(sha)}.`)
      parent = commitSnapshot(repoRoot, sha, null, { forkPoint: true })
    } else {
      throw new Error(
        'HEAD shares no history with upstream. Rerun with --fork-point <upstream sha> ' +
          'naming the upstream commit Vshu was forked from (see the header of this script).'
      )
    }
  }

  const commit = commitSnapshot(repoRoot, upstreamSha, parent, {})
  // Compare-and-swap so a concurrent update of the branch is never clobbered.
  git(['update-ref', ref, commit, tip.ok ? tip.out : ''], repoRoot)
  console.log(`${SNAPSHOT_BRANCH} -> ${short(commit)}`)
}

/** The fork-point root of upstream-vshu when HEAD does not yet share history with it. */
function pendingForkPoint(repoRoot) {
  if (git(['merge-base', 'HEAD', SNAPSHOT_BRANCH], repoRoot, { allowFail: true }).ok) {
    return null
  }
  const roots = git(['rev-list', '--max-parents=0', SNAPSHOT_BRANCH], repoRoot).out.split('\n')
  if (roots.length !== 1) {
    throw new Error(`${SNAPSHOT_BRANCH} has ${roots.length} root commits; expected one.`)
  }
  return roots[0]
}

function forkPointMergeArgs(root) {
  const message = `chore(sync): record Vshu sync point ${short(root)} (no file changes)`
  return ['merge', '-s', 'ours', '--allow-unrelated-histories', '-m', message, root]
}

function unmergedPaths(repoRoot) {
  return new Set(lines(git(['diff', '--name-only', '--diff-filter=U'], repoRoot).out))
}

function inChunks(items, run) {
  for (let i = 0; i < items.length; i += 100) {
    run(items.slice(i, i + 100))
  }
}

/** Applies KEEP_OURS / DROP_UPSTREAM to an in-progress merge. */
function protectVshuPaths(repoRoot) {
  step('Keeping Vshu branding and dropping upstream CI files')
  const unmerged = unmergedPaths(repoRoot)
  const touched = new Set([
    ...lines(git(['diff', '--cached', '--name-only', 'HEAD'], repoRoot).out),
    ...unmerged
  ])
  const restore = []
  const remove = []
  const review = []
  const guarded = [...touched].filter((file) => matchesAny(file, [...KEEP_OURS, ...DROP_UPSTREAM]))
  for (const file of guarded) {
    const inHead = git(['cat-file', '-e', `HEAD:${file}`], repoRoot, { allowFail: true }).ok
    const action = classifyMergedPath(file, { inHead, unmerged: unmerged.has(file) })
    if (action === 'ours') {
      restore.push(file)
    } else if (action === 'remove') {
      remove.push(file)
    } else if (action === 'warn') {
      review.push(file)
    }
  }
  inChunks(restore, (chunk) => git(['checkout', 'HEAD', '--', ...chunk], repoRoot))
  inChunks(remove, (chunk) => git(['rm', '-q', '-f', '--ignore-unmatch', '--', ...chunk], repoRoot))
  console.log(`Kept Vshu's copy of ${restore.length} path(s); dropped ${remove.length}.`)
  for (const file of restore) {
    console.log(`  kept    ${file}`)
  }
  if (review.length) {
    console.log('New upstream files under branded paths (check they carry no upstream logo):')
    for (const file of review) {
      console.log(`  review  ${file}`)
    }
  }
}

/** Regenerates the brand assets; commits them if anything changed. */
function regenerateBranding(repoRoot) {
  const script = path.join(repoRoot, 'scripts', 'apply-vshu-branding.mjs')
  if (!fs.existsSync(script)) {
    return
  }
  try {
    createRequire(script).resolve('sharp')
  } catch {
    console.log('sharp is not installed yet: run `pnpm install`, then')
    console.log('`node scripts/apply-vshu-branding.mjs` (update-vshu.bat does this).')
    return
  }
  step('Regenerating brand assets (apply-vshu-branding.mjs)')
  const result = spawnSync(process.execPath, [script], { cwd: repoRoot, stdio: 'inherit' })
  if (result.status !== 0) {
    console.log('Brand asset generation failed; the merged copies were kept.')
    return
  }
  if (git(['status', '--porcelain', '--untracked-files=no'], repoRoot).out) {
    git(['add', '-u'], repoRoot)
    git(
      ['commit', '-q', '-m', 'chore(branding): regenerate Vshu brand assets after upstream sync'],
      repoRoot
    )
    console.log('Committed the regenerated brand assets.')
  }
}

function runRebrandCheck(repoRoot) {
  step('Checking the rebrand (vshu-rebrand.mjs --check)')
  const codemod = path.join(repoRoot, 'scripts', 'vshu-rebrand.mjs')
  const result = spawnSync(process.execPath, [codemod, '--check'], {
    cwd: repoRoot,
    stdio: 'inherit'
  })
  if (result.status !== 0) {
    console.log('Unbranded text remains: run `node scripts/vshu-rebrand.mjs`, review, commit.')
  }
  return result.status === 0
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(fs.readFileSync(import.meta.filename, 'utf8').split(/\r?\n\r?\nimport/)[0])
    return
  }
  const repoRoot = git(['rev-parse', '--show-toplevel'], import.meta.dirname).out

  if (opts.merge || (!opts.snapshotOnly && !opts.dryRun)) {
    if (git(['status', '--porcelain', '--untracked-files=no'], repoRoot).out) {
      throw new Error('Working tree has uncommitted changes. Commit or stash them first.')
    }
    const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot, {
      allowFail: true
    })
    if (!branch.ok || branch.out === SNAPSHOT_BRANCH) {
      throw new Error(`Check out your Vshu branch first (not detached, not ${SNAPSHOT_BRANCH}).`)
    }
  }

  step(`Ensuring remote ${UPSTREAM_REMOTE} (${UPSTREAM_URL})`)
  ensureUpstreamRemote(repoRoot)
  ensureOursMergeDriver(repoRoot)
  if (opts.fetch) {
    git(['fetch', '--no-tags', UPSTREAM_REMOTE, UPSTREAM_BRANCH], repoRoot, { inherit: true })
  }
  const upstreamRef = `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`
  const upstreamSha = git(['rev-parse', '--verify', `${upstreamRef}^{commit}`], repoRoot).out
  console.log(`${upstreamRef} is ${short(upstreamSha)}`)

  if (opts.dryRun) {
    dryRun(repoRoot, upstreamSha)
    return
  }
  updateSnapshotBranch(repoRoot, upstreamSha, opts.forkPoint)
  if (opts.snapshotOnly) {
    return
  }

  const behind = git(['rev-list', '--count', `HEAD..${SNAPSHOT_BRANCH}`], repoRoot).out
  if (behind === '0') {
    console.log(`\nAlready up to date: HEAD contains ${SNAPSHOT_BRANCH}.`)
    return
  }
  const forkRoot = pendingForkPoint(repoRoot)
  if (!opts.merge) {
    console.log(`\n${SNAPSHOT_BRANCH} has ${behind} commit(s) not in HEAD. To finish the sync:`)
    if (forkRoot) {
      console.log('  # one time: record the fork point (changes no files)')
      console.log(`  git ${forkPointMergeArgs(forkRoot).join(' ')}`)
    }
    console.log(`  git merge ${SNAPSHOT_BRANCH}`)
    console.log('  # resolve any conflicts and commit, then:')
    console.log('  node scripts/apply-vshu-branding.mjs && node scripts/vshu-rebrand.mjs --check')
    console.log('Or rerun with --merge, which also keeps the branded files automatically.')
    return
  }

  if (forkRoot) {
    step(`Recording fork point ${short(forkRoot)} (merge -s ours: no file changes)`)
    git(forkPointMergeArgs(forkRoot), repoRoot, { inherit: true })
  }
  step(`Merging ${SNAPSHOT_BRANCH} into the current branch`)
  git(['merge', '--no-ff', '--no-commit', SNAPSHOT_BRANCH], repoRoot, {
    allowFail: true,
    inherit: true
  })
  if (!git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], repoRoot, { allowFail: true }).ok) {
    throw new Error('git merge did not start (see its output above); nothing was changed.')
  }
  protectVshuPaths(repoRoot)
  const remaining = [...unmergedPaths(repoRoot)]
  if (remaining.length) {
    console.error(`\n${remaining.length} file(s) still conflict:`)
    for (const file of remaining) {
      console.error(`  ${file}`)
    }
    console.error('Resolve them (`git status`), commit, then run')
    console.error(
      '`node scripts/apply-vshu-branding.mjs` and `node scripts/vshu-rebrand.mjs --check`.'
    )
    console.error('To give up: git merge --abort')
    process.exitCode = 1
    return
  }
  git(['commit', '--no-edit', '-q'], repoRoot)
  console.log(`Merged ${SNAPSHOT_BRANCH}.`)
  if (opts.branding) {
    regenerateBranding(repoRoot)
  }
  if (!runRebrandCheck(repoRoot)) {
    process.exitCode = 1
    return
  }
  console.log('\nSync complete. Run `pnpm install` if dependencies changed.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (error) {
    console.error(`sync-upstream: ${error.message}`)
    process.exitCode = 1
  }
}
