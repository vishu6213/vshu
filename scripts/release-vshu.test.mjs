// Run with: node --test scripts/release-vshu.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseArgs, parseLatestYml, releaseAssetNames } from './release-vshu.mjs'

test('parseArgs defaults to build + publish and rejects unknown or empty combinations', () => {
  const opts = parseArgs([])
  assert.equal(opts.build, true)
  assert.equal(opts.publish, true)
  assert.equal(parseArgs(['--build-only']).publish, false)
  assert.equal(parseArgs(['--skip-build']).build, false)
  assert.equal(parseArgs(['--notes-file', 'notes.md']).notesFile, 'notes.md')
  assert.equal(parseArgs(['--notes-file=notes.md', '--draft']).draft, true)
  assert.throws(() => parseArgs(['--notes-file']), /needs a path/)
  assert.throws(() => parseArgs(['--publish']), /Unknown argument/)
  assert.throws(() => parseArgs(['--build-only', '--skip-build']), /do nothing/)
})

test('asset names have no spaces and keep the updater installer suffix', () => {
  const names = releaseAssetNames('1.2.3')
  assert.equal(names.installer, 'Vshu-1.2.3-windows-setup.exe')
  assert.equal(names.blockmap, 'Vshu-1.2.3-windows-setup.exe.blockmap')
  assert.equal(names.manifest, 'latest.yml')
  assert.match(names.installer, /windows-setup\.exe$/)
  assert.doesNotMatch(names.installer, /\s/)
})

test('parseLatestYml reads electron-builder update metadata', () => {
  const text = [
    'version: 1.2.3',
    'files:',
    '  - url: Vshu-1.2.3-windows-setup.exe',
    '    sha512: abc==',
    '    size: 10',
    'path: Vshu-1.2.3-windows-setup.exe',
    'sha512: abc==',
    "releaseDate: '2026-11-25T00:00:00.000Z'",
    ''
  ].join('\r\n')
  assert.deepEqual(parseLatestYml(text), {
    version: '1.2.3',
    path: 'Vshu-1.2.3-windows-setup.exe',
    sha512: 'abc=='
  })
})
