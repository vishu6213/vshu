// Run with: node --test scripts/sync-upstream.test.mjs
// Avoids literal upstream brand words: scripts/vshu-rebrand.mjs rewrites this file.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import fs from 'node:fs'
import path from 'node:path'

import {
  DROP_UPSTREAM,
  KEEP_OURS,
  UPSTREAM_URL,
  buildCommitMessage,
  classifyMergedPath,
  isUpstreamUrl,
  matchesAny,
  parseArgs,
  parseUpstreamCommit,
  pinPackageFields
} from './sync-upstream.mjs'

const SHA = 'a'.repeat(40)

test('parseArgs reads flags and rejects unknown or conflicting ones', () => {
  assert.deepEqual(parseArgs([]), {
    merge: false,
    snapshotOnly: false,
    dryRun: false,
    fetch: true,
    branding: true,
    help: false,
    forkPoint: null
  })
  assert.equal(parseArgs(['--merge']).merge, true)
  assert.equal(parseArgs(['--dry-run']).dryRun, true)
  assert.equal(parseArgs(['--no-branding']).branding, false)
  assert.throws(() => parseArgs(['--merge', '--dry-run']), /mutually exclusive/)
  assert.equal(parseArgs(['--no-fetch']).fetch, false)
  assert.equal(parseArgs(['--fork-point', 'abc123', '--merge']).forkPoint, 'abc123')
  assert.equal(parseArgs(['--fork-point=abc123']).forkPoint, 'abc123')
  assert.throws(() => parseArgs(['--fork-point']), /needs an upstream commit/)
  assert.throws(() => parseArgs(['--force']), /Unknown argument/)
  assert.throws(() => parseArgs(['--merge', '--snapshot-only']), /mutually exclusive/)
})

test('isUpstreamUrl accepts https and ssh forms of the upstream repo only', () => {
  assert.equal(isUpstreamUrl(UPSTREAM_URL), true)
  assert.equal(isUpstreamUrl(UPSTREAM_URL.replace(/\.git$/, '')), true)
  assert.equal(isUpstreamUrl(UPSTREAM_URL.replace('https://github.com/', 'git@github.com:')), true)
  assert.equal(isUpstreamUrl('https://github.com/vishu6213/vshu.git'), false)
})

test('commit message round-trips the upstream sha', () => {
  const message = buildCommitMessage(SHA, 'feat: something')
  assert.equal(parseUpstreamCommit(message), SHA)
  assert.match(message.split('\n')[0], /@aaaaaaaaaaaa$/)
  assert.equal(parseUpstreamCommit('chore: unrelated commit'), null)
  const forkPoint = buildCommitMessage(SHA, 'feat: base', { forkPoint: true })
  assert.match(forkPoint, /fork point/)
  assert.equal(parseUpstreamCommit(forkPoint), SHA)
})

test('branding paths match KEEP_OURS and upstream CI matches DROP_UPSTREAM', () => {
  for (const file of [
    'README.md',
    'resources/build/icon.ico',
    'resources/build/icon.icns',
    'resources/logo.svg',
    'resources/branding/vshu-logo-source.png',
    'resources/app-icons/vshu-blue.png',
    'resources/tray/vshu-menu-barTemplate@2x.png',
    'mobile/assets/icon.png',
    'src/renderer/src/assets/vshu-logo.svg'
  ]) {
    assert.equal(matchesAny(file, KEEP_OURS), true, file)
  }
  for (const file of [
    'src/main/index.ts',
    'resources/build/entitlements.mac.plist',
    'package.json'
  ]) {
    assert.equal(matchesAny(file, KEEP_OURS), false, file)
  }
  assert.equal(matchesAny('.github/workflows/pr.yml', DROP_UPSTREAM), true)
  assert.equal(matchesAny('.github/actions/setup/action.yml', DROP_UPSTREAM), false)
})

test('classifyMergedPath keeps ours, drops upstream CI and flags new branded files', () => {
  assert.equal(classifyMergedPath('src/main/index.ts', { inHead: true, unmerged: true }), null)
  assert.equal(classifyMergedPath('resources/logo.svg', { inHead: true, unmerged: false }), 'ours')
  assert.equal(
    classifyMergedPath('.github/workflows/ci.yml', { inHead: true, unmerged: true }),
    'ours'
  )
  assert.equal(
    classifyMergedPath('.github/workflows/new.yml', { inHead: false, unmerged: false }),
    'remove'
  )
  assert.equal(
    classifyMergedPath('resources/tray/new.png', { inHead: false, unmerged: false }),
    'warn'
  )
  // Vshu deleted it, upstream edited it: stay deleted.
  assert.equal(
    classifyMergedPath('resources/tray/old.png', { inHead: false, unmerged: true }),
    'remove'
  )
})

test('pinPackageFields keeps Vshu identity fields and the upstream layout', () => {
  const upstream =
    '{\r\n  "name": "vshu",\r\n  "version": "1.4.300",\r\n  "author": "upstream",\r\n  "dependencies": {\r\n    "version": "x"\r\n  }\r\n}\r\n'
  const ours =
    '{\n  "name": "vshu",\n  "version": "1.0.2",\n  "description": "Vshu \\"IDE\\"",\n  "author": "Vshu Contributors",\n  "dependencies": {}\n}\n'
  const pinned = pinPackageFields(upstream, ours)
  assert.equal(
    pinned,
    '{\r\n  "name": "vshu",\r\n  "version": "1.0.2",\r\n  "author": "Vshu Contributors",\r\n  "dependencies": {\r\n    "version": "x"\r\n  }\r\n}\r\n'
  )
  assert.equal(pinPackageFields(upstream, '{}'), upstream)
})

test('.gitattributes marks every KEEP_OURS and DROP_UPSTREAM pattern merge=ours', () => {
  const attributes = fs.readFileSync(path.join(import.meta.dirname, '..', '.gitattributes'), 'utf8')
  const marked = new Set(
    attributes
      .split(/\r?\n/)
      .filter((line) => line.endsWith(' merge=ours'))
      .map((line) => line.replace(/^\//, '').replace(/ merge=ours$/, ''))
  )
  assert.deepEqual([...marked].sort(), [...KEEP_OURS, ...DROP_UPSTREAM].sort())
})
