// Remember repeatable deployment refusals per app version; host-fixable settings must be reprobed.

export class VshudHostUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VshudHostUnsupportedError'
  }
}

export class VshudArtifactsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VshudArtifactsUnavailableError'
  }
}

export class VshudStdioBridgeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VshudStdioBridgeUnavailableError'
  }
}

export const VSHUD_TUNNEL_UNAVAILABLE_REASON = 'ssh_tunnel_unavailable'
export const VSHUD_WINDOWS_LAUNCH_REFUSED_CODE = 'vshud_windows_launch_refused'
export const VSHUD_WINDOWS_COMMAND_LINE_UNSAFE_CODE = 'vshud_windows_command_line_unsafe'

export type VshudHostUnavailableReason =
  | 'unsupported_host'
  | 'artifacts_unavailable'
  | 'libc_unidentified'
  | 'runtime_self_test'
  | 'runtime_noexec'
  | 'windows_build_unsupported'
  | 'windows_no_extractor'
  | 'security_software'
  | 'native_preflight'
  | typeof VSHUD_TUNNEL_UNAVAILABLE_REASON

const UNAVAILABLE_BY_ERROR_NAME: Record<string, VshudHostUnavailableReason> = {
  VshudHostUnsupportedError: 'unsupported_host',
  VshudArtifactsUnavailableError: 'artifacts_unavailable',
  VshudRemoteLaunchUnsupportedError: 'unsupported_host',
  UnidentifiedHostLibcError: 'libc_unidentified',
  RemoteNodeRuntimeSelfTestError: 'runtime_self_test',
  RemoteNodeRuntimeNoexecError: 'runtime_noexec',
  RemoteWindowsBuildUnsupportedError: 'windows_build_unsupported',
  RemoteNodeRuntimeNoExtractorError: 'windows_no_extractor',
  RemoteNodeRuntimeSecurityModifiedError: 'security_software',
  VshudStdioBridgeUnavailableError: VSHUD_TUNNEL_UNAVAILABLE_REASON,
  VshudWindowsLaunchRefusedError: 'unsupported_host',
  VshudWindowsCommandLineError: 'unsupported_host'
}

// Native preflight, PTY self-test and permanent Windows refusals repeat; transient races do not.
const UNAVAILABLE_BY_DEFERRAL_CODE: Record<string, VshudHostUnavailableReason> = {
  vshud_candidate_preflight_failed: 'native_preflight',
  vshud_activation_pty_self_test_failed: 'native_preflight',
  [VSHUD_WINDOWS_LAUNCH_REFUSED_CODE]: 'unsupported_host',
  [VSHUD_WINDOWS_COMMAND_LINE_UNSAFE_CODE]: 'unsupported_host'
}

// Reprobed on every connect, so fixing or upgrading the host needs no new Vshu version.
const FIXABLE_ON_HOST: ReadonlySet<string> = new Set<VshudHostUnavailableReason>([
  'runtime_noexec',
  'windows_build_unsupported',
  'windows_no_extractor'
])

export function isVshudHostUnavailableFixableOnHost(reason: string): boolean {
  return FIXABLE_ON_HOST.has(reason)
}

export function vshudCandidateLaunchFailureCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return code === VSHUD_WINDOWS_LAUNCH_REFUSED_CODE ||
    code === VSHUD_WINDOWS_COMMAND_LINE_UNSAFE_CODE
    ? code
    : 'vshud_candidate_launch_failed'
}

export function classifyVshudHostUnavailable(failure: unknown): VshudHostUnavailableReason | null {
  if (failure instanceof Error) {
    return UNAVAILABLE_BY_ERROR_NAME[failure.name] ?? null
  }
  if (failure && typeof failure === 'object' && 'code' in failure) {
    const code = failure.code
    return typeof code === 'string' ? (UNAVAILABLE_BY_DEFERRAL_CODE[code] ?? null) : null
  }
  return null
}
