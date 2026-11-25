import type { EnvironmentDoctorCheck } from '../../shared/workspace-setup/environment-doctor/environment-doctor-types'
import { parseVshuYaml } from '../../shared/workspace-setup/vshu-yaml'
import { VSHU_YAML_FILE_NAMES } from '../../shared/workspace-setup/vshu-yaml-file-names'
import {
  check,
  PROBE_TIMEOUT_MS,
  runSafely,
  withOutputTail,
  type EnvironmentDoctorCommandResult,
  type EnvironmentDoctorDeps
} from './environment-doctor-check'
import type { GitCheckoutProbe } from './environment-doctor-git'

// Vshu writes .cmd or .sh on Windows depending on the script's shell, so look for both.
const SETUP_RUNNER_NAMES = ['vshu/setup-runner.sh', 'vshu/setup-runner.cmd'] as const

export async function checkSetup(
  deps: EnvironmentDoctorDeps,
  context: {
    root: string
    runSetup: boolean
    checkout: GitCheckoutProbe
    impliesInstall: boolean
    readRepoFile: (relativePath: string) => Promise<string | null>
  }
): Promise<EnvironmentDoctorCheck[]> {
  let yaml: string | null = null
  for (const fileName of VSHU_YAML_FILE_NAMES) {
    yaml ??= await context.readRepoFile(fileName)
  }
  const script = yaml ? parseVshuYaml(yaml)?.scripts.setup?.trim() : undefined
  if (!script) {
    return [
      context.impliesInstall
        ? check('setup', 'setup.script', 'warn', 'vshu.yaml has no setup script.', {
            remediation: 'Add scripts.setup to vshu.yaml so new workspaces install dependencies.'
          })
        : check('setup', 'setup.script', 'pass', 'No setup script is configured.')
    ]
  }
  if (context.runSetup) {
    const result = await deps
      .runSetupScript({
        worktreePath: context.root,
        rootPath: primaryCheckout(context.root, context.checkout),
        script
      })
      .catch((error: unknown): EnvironmentDoctorCommandResult => ({
        code: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false
      }))
    if (result.code === 0) {
      return [check('setup', 'setup.run', 'pass', 'Setup script ran and exited 0.')]
    }
    return [
      check(
        'setup',
        'setup.run',
        'fail',
        result.timedOut
          ? 'Setup script did not finish in time.'
          : `Setup script exited with code ${result.code ?? 'unknown'}.`,
        { remediation: withOutputTail('Fix scripts.setup in vshu.yaml, then re-run.', result) }
      )
    ]
  }
  const launched =
    context.checkout.kind === 'checkout' && (await setupRunnerExists(context.root, deps))
  return [
    launched
      ? check(
          'setup',
          'setup.run',
          'pass',
          'Setup script is configured and has run here. Use --run-setup to check its exit code.'
        )
      : check('setup', 'setup.run', 'warn', 'Setup script is configured but has not run here.', {
          remediation: 'Re-run the doctor with --run-setup to run it and check the result.'
        })
  ]
}

async function setupRunnerExists(root: string, deps: EnvironmentDoctorDeps): Promise<boolean> {
  const result = await runSafely(
    deps,
    'git',
    [
      'rev-parse',
      '--path-format=absolute',
      ...SETUP_RUNNER_NAMES.flatMap((name) => ['--git-path', name])
    ],
    { cwd: root, timeoutMs: PROBE_TIMEOUT_MS }
  )
  if (result.code !== 0) {
    return false
  }
  const paths = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const path of paths) {
    if (await deps.exists(path)) {
      return true
    }
  }
  return false
}

/** VSHU_ROOT_PATH is the primary checkout; a linked worktree's common dir is <primary>/.git. */
function primaryCheckout(root: string, checkout: GitCheckoutProbe): string {
  if (checkout.kind !== 'checkout' || !/[\\/]\.git$/.test(checkout.commonDir)) {
    return root
  }
  return checkout.commonDir.replace(/[\\/]\.git$/, '')
}
