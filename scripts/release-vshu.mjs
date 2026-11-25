#!/usr/bin/env node
// Builds the Windows installer and publishes it as a GitHub Release of vishu6213/vshu, which is
// where installed copies of Vshu look for in-app updates (Settings > General).
//
//   node scripts/release-vshu.mjs                build, then create release v<package.json version>
//   node scripts/release-vshu.mjs --build-only   build only (dist/ gets installer, blockmap, latest.yml)
//   node scripts/release-vshu.mjs --skip-build   publish what a previous build left in dist/
//
// Publishing options:
//   --notes-file <file>  release notes (default: GitHub's generated notes)
//   --draft              create a draft (installed apps do not see it until you publish it)
//   --prerelease         mark as prerelease (only offered to users on the RC channel)
//   --clobber            the release already exists: replace its assets (used by CI re-runs)
//   --dry-run            print the gh commands instead of running them
//
// Needs the GitHub CLI logged in to an account that can write to the repo (`gh auth login`),
// or GH_TOKEN in CI. See RELEASING.md.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const RELEASE_REPO = 'vishu6213/vshu'
const repoRoot = path.resolve(import.meta.dirname, '..')
const distDir = path.join(repoRoot, 'dist')
const FLAGS = new Set([
  '--build-only',
  '--skip-build',
  '--draft',
  '--prerelease',
  '--clobber',
  '--dry-run',
  '--help',
  '-h'
])

export function parseArgs(argv) {
  const opts = {
    build: true,
    publish: true,
    draft: false,
    prerelease: false,
    clobber: false,
    dryRun: false,
    help: false,
    notesFile: null
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--notes-file' || arg.startsWith('--notes-file=')) {
      opts.notesFile = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i]
      if (!opts.notesFile) {
        throw new Error('--notes-file needs a path')
      }
    } else if (!FLAGS.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  opts.build = !argv.includes('--skip-build')
  opts.publish = !argv.includes('--build-only')
  opts.draft = argv.includes('--draft')
  opts.prerelease = argv.includes('--prerelease')
  opts.clobber = argv.includes('--clobber')
  opts.dryRun = argv.includes('--dry-run')
  opts.help = argv.includes('--help') || argv.includes('-h')
  if (!opts.build && !opts.publish) {
    throw new Error('--build-only and --skip-build together do nothing')
  }
  return opts
}

/** Asset names for a version; must match win.artifactName in config/electron-builder.simple.cjs. */
export function releaseAssetNames(version) {
  const installer = `Vshu-${version}-windows-setup.exe`
  return { installer, blockmap: `${installer}.blockmap`, manifest: 'latest.yml' }
}

/** Reads version, path and sha512 from an electron-builder latest.yml (flat, no YAML dependency). */
export function parseLatestYml(text) {
  const field = (name) => new RegExp(`^${name}: *'?([^'\\r\\n]+)'?\\s*$`, 'm').exec(text)?.[1]
  return { version: field('version'), path: field('path'), sha512: field('sha512') }
}

function run(command, args, { allowFail = false, capture = false } = {}) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    // pnpm and gh are .cmd shims on some Windows installs.
    shell: process.platform === 'win32' && command === 'pnpm'
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${command} ${args[0]} failed (exit ${result.status})`)
  }
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

function quiet(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' })
  return { ok: !result.error && result.status === 0, out: (result.stdout ?? '').trim() }
}

function cleanPreviousOutputs() {
  // Stale bundles from older builds (renamed or deleted modules) would otherwise ship again.
  fs.rmSync(path.join(repoRoot, 'out'), { recursive: true, force: true })
  if (!fs.existsSync(distDir)) {
    return
  }
  for (const name of fs.readdirSync(distDir)) {
    if (/^latest.*\.yml$|\.blockmap$|-windows-setup\.exe$|^win-unpacked$|^builder-/.test(name)) {
      fs.rmSync(path.join(distDir, name), { recursive: true, force: true })
    }
  }
}

function build() {
  cleanPreviousOutputs()
  run('pnpm', ['run', 'build:cli'])
  run('pnpm', ['run', 'build:electron-vite'])
  // Rebuilds native addons for Electron's ABI (MSVC source build, or the pinned prebuilt
  // addons when Visual Studio is missing).
  run('pnpm', ['run', 'ensure:electron-runtime'])
  run(process.execPath, ['scripts/package-vshu-app.mjs', '--installer', '--skip-installed-refresh'])
}

function verifyAssets(version) {
  const names = releaseAssetNames(version)
  const files = Object.values(names).map((name) => path.join(distDir, name))
  for (const file of files) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${path.relative(repoRoot, file)}. Build first (drop --skip-build).`)
    }
  }
  const manifest = parseLatestYml(fs.readFileSync(path.join(distDir, names.manifest), 'utf8'))
  if (manifest.version !== version || manifest.path !== names.installer) {
    throw new Error(
      `dist/latest.yml describes ${manifest.path} ${manifest.version}, expected ${names.installer} ${version}.`
    )
  }
  const digest = createHash('sha512')
    .update(fs.readFileSync(path.join(distDir, names.installer)))
    .digest('base64')
  if (digest !== manifest.sha512) {
    throw new Error('dist/latest.yml sha512 does not match the installer; rebuild.')
  }
  console.log(`Verified ${names.installer}, its blockmap and latest.yml (${version}).`)
  return files
}

function publish(version, files, opts) {
  const tag = `v${version}`
  const gh = (args, extra) =>
    opts.dryRun
      ? (console.log(`[dry-run] gh ${args.join(' ')}`), { ok: true })
      : run('gh', args, extra)
  if (!quiet('gh', ['--version']).ok) {
    throw new Error('GitHub CLI (gh) not found. Install it from https://cli.github.com/.')
  }
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN && !quiet('gh', ['auth', 'status']).ok) {
    throw new Error('gh is not logged in. Run `gh auth login` first.')
  }

  const existing = quiet('gh', [
    'release',
    'view',
    tag,
    '--repo',
    RELEASE_REPO,
    '--json',
    'tagName'
  ])
  if (existing.ok) {
    if (!opts.clobber) {
      throw new Error(
        `Release ${tag} already exists. Bump "version" in package.json, or pass --clobber to replace its assets.`
      )
    }
    gh(['release', 'upload', tag, ...files, '--repo', RELEASE_REPO, '--clobber'])
    return tag
  }

  const args = [
    'release',
    'create',
    tag,
    ...files,
    '--repo',
    RELEASE_REPO,
    '--title',
    `Vshu ${version}`
  ]
  args.push(...(opts.notesFile ? ['--notes-file', opts.notesFile] : ['--generate-notes']))
  if (opts.draft) {
    args.push('--draft')
  }
  if (opts.prerelease) {
    args.push('--prerelease')
  }
  // An existing tag on GitHub is used as is; otherwise gh creates it at HEAD, which must be pushed.
  if (!quiet('gh', ['api', `repos/${RELEASE_REPO}/git/ref/tags/${tag}`]).ok) {
    const head = quiet('git', ['rev-parse', 'HEAD']).out
    // --jq keeps the reply small: a commit touching many files overflows spawnSync's buffer.
    const onGitHub = quiet('gh', ['api', `repos/${RELEASE_REPO}/commits/${head}`, '--jq', '.sha'])
    if (!onGitHub.ok && !opts.dryRun) {
      throw new Error(
        `HEAD (${head.slice(0, 12)}) is not on github.com/${RELEASE_REPO}. Push your branch first.`
      )
    }
    args.push('--target', head)
  }
  gh(args)
  return tag
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(fs.readFileSync(import.meta.filename, 'utf8').split('\n\nimport')[0])
    return
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  console.log(`=== Vshu ${version} release (${RELEASE_REPO}) ===`)
  if (opts.build) {
    build()
  }
  const files = verifyAssets(version)
  if (!opts.publish) {
    return
  }
  const tag = publish(version, files, opts)
  console.log(`\nPublished https://github.com/${RELEASE_REPO}/releases/tag/${tag}`)
  if (opts.draft) {
    console.log('It is a draft: publish it on GitHub before installed apps can see it.')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (error) {
    console.error(`release-vshu: ${error.message}`)
    process.exitCode = 1
  }
}
