// Runs the headless-server suites under the pinned Node (design D4/D4a), not the host's.
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { globSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  VSHUD_CLI_ENTRY_FILENAME,
  VSHUD_SERVER_ENTRY_FILENAME,
  VSHUD_VERSION_FILENAME
} from '../../../../src/shared/remote-runtime/vshud-distribution/vshud-artifacts.ts'
import { NODE_RUNTIME_PIN } from '../../../../src/shared/node-runtime/node-runtime-pin.ts'
import {
  VSHUD_PROFILE_PREFLIGHT_FLAG,
  parseVshudProfilePreflight
} from '../../../../src/shared/remote-runtime/vshud-distribution/vshud-profile-preflight.ts'
import { packagedNodeRuntimePath } from '../../vshud-distribution/prebuilds/build-vshud-node.mjs'
import { ensurePinnedNodeExecutable } from '../../vshud-distribution/prebuilds/pinned-node-downloads.mjs'
import { currentTarget } from '../../vshud-distribution/prebuilds/server-build-target.mjs'
import { UNIT_INCLUDE } from './dependency-graph/ci-unit-files.mjs'
import { runProcessSync } from '@vshu/process-host'
import { describeProcessFailure } from '../../tool-invocation/process-failure-message.mjs'
import {
  nodeServerTestPaths,
  REQUIRED_TEST_INPUTS_ENV
} from '../../node-server/qualification/node-server-test-paths.mjs'

const root = resolve(import.meta.dirname, '../../../..')
const target = currentTarget()
const artifact = process.argv.includes('--artifact')
// Lanes that provide the pinned Bun and the last Bun vshud slot (design D7 upgrade and rollback).
const crossRuntime = process.argv.includes('--cross-runtime')
const testArgs = process.argv
  .slice(2)
  .filter((arg) => arg !== '--artifact' && arg !== '--cross-runtime')
const packageDir = join(root, 'out', 'vshud')
const runtimePath = artifact
  ? packagedNodeRuntimePath(packageDir, target)
  : await ensurePinnedNodeExecutable({ target })
// Require lane-declared packaged runtime inputs; their tests must fail on absence instead of silently skipping.
const env = {
  ...process.env,
  VSHU_BACKGROUND_LAUNCH: '1',
  VSHU_PINNED_NODE: runtimePath,
  [REQUIRED_TEST_INPUTS_ENV]: [artifact && 'artifact', crossRuntime && 'cross-runtime']
    .filter(Boolean)
    .join(',')
}

function run(program, args) {
  const result = runProcessSync({
    program,
    args,
    cwd: root,
    env,
    stdio: 'inherit',
    timeoutMs: null
  })
  if (result.code !== 0) {
    process.exit(result.code ?? 1)
  }
}

if (artifact) {
  const nonce = randomUUID()
  const result = runProcessSync({
    program: runtimePath,
    args: [join(packageDir, VSHUD_SERVER_ENTRY_FILENAME), VSHUD_PROFILE_PREFLIGHT_FLAG, nonce],
    cwd: root,
    env,
    timeoutMs: 90_000
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    throw new Error(`Bundled runtime readiness failed: ${describeProcessFailure(result)}`)
  }
  const response = parseVshudProfilePreflight(
    result.stdout,
    nonce,
    { runtime: 'node', runtimeVersion: NODE_RUNTIME_PIN.version },
    readFileSync(join(packageDir, VSHUD_VERSION_FILENAME), 'utf8').trim()
  )
  process.stdout.write(`${JSON.stringify({ target, ...response })}\n`)

  assertBundledCliPlansSkillInstall()
}
run(runtimePath, [
  join(root, 'node_modules/vitest/vitest.mjs'),
  'run',
  '--config',
  'config/vitest.config.ts',
  ...(testArgs.length > 0 ? testArgs : defaultTestArgs())
])

function defaultTestArgs() {
  // Vitest 5 ignores CLI --exclude for inline projects; resolve/filter substring selectors first. Electron probes belong in desktop jobs, not displayless containers.
  const selectors = nodeServerTestPaths()
  return globSync(UNIT_INCLUDE, { cwd: root })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => selectors.some((selector) => path.includes(selector)))
    .filter((path) => !path.endsWith('.electron.test.ts'))
    .sort()
}

/** The server's own CLI must plan an install of Vshu's bundled skills, offline and npx-free. */
function assertBundledCliPlansSkillInstall() {
  // Why the real path: the planner reports real paths, and macOS tmpdir is a /var symlink.
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'vshud-skills-home-')))
  const { VSHU_CLI_CWD: _forwarded, ...hostEnv } = env
  try {
    const cli = runProcessSync({
      program: runtimePath,
      args: [
        join(packageDir, VSHUD_CLI_ENTRY_FILENAME),
        'skills',
        'install',
        '--skill',
        'vshu-cli',
        '--agent',
        'universal',
        '--dry-run',
        '--json'
      ],
      cwd: home,
      env: { ...hostEnv, HOME: home, USERPROFILE: home },
      timeoutMs: 90_000
    })
    const failure = describeProcessFailure(cli)
    if (cli.code !== 0 || cli.timedOut || cli.outputTruncated) {
      throw new Error(`Bundled CLI skills dry-run failed: ${failure}`)
    }
    const result = JSON.parse(cli.stdout)
    const ops = result.plan?.skills?.find((skill) => skill.name === 'vshu-cli')?.ops ?? []
    if (
      result.executed !== false ||
      !/^[0-9a-f]{64}$/.test(result.planDigest) ||
      ops.length === 0 ||
      !ops.every((op) => op.path.startsWith(home))
    ) {
      throw new Error(`Bundled CLI did not plan vshu-cli into ${home}: ${cli.stdout}`)
    }
    if (readdirSync(home).length > 0) {
      throw new Error(
        `Bundled CLI skills dry-run wrote into ${home}: ${readdirSync(home).join(', ')}`
      )
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
