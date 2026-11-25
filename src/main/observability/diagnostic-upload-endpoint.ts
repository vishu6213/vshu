export function resolveDiagnosticBuildTokenEndpoint(): string | null {
  const endpoint =
    typeof VSHU_DIAGNOSTICS_TOKEN_URL !== 'undefined'
      ? VSHU_DIAGNOSTICS_TOKEN_URL
      : ((globalThis as { VSHU_DIAGNOSTICS_TOKEN_URL?: string | null })
          .VSHU_DIAGNOSTICS_TOKEN_URL ?? null)
  return typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : null
}

export function resolveDiagnosticBuildIdentity(): 'stable' | 'rc' | null {
  const ident =
    typeof VSHU_BUILD_IDENTITY !== 'undefined'
      ? VSHU_BUILD_IDENTITY
      : ((globalThis as { VSHU_BUILD_IDENTITY?: 'stable' | 'rc' | null }).VSHU_BUILD_IDENTITY ??
        null)
  return ident === 'stable' || ident === 'rc' ? ident : null
}

export function resolveDiagnosticTokenEndpoint(): string | null {
  const buildEndpoint = resolveDiagnosticBuildTokenEndpoint()
  // Pin official builds to the support endpoint named by the UI, regardless of user environment.
  if (resolveDiagnosticBuildIdentity()) {
    return buildEndpoint
  }
  const fromEnv = process.env.VSHU_DIAGNOSTICS_TOKEN_URL
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
  }
  return buildEndpoint
}

export function resolveDiagnosticVshuChannel(): 'stable' | 'rc' | 'dev' {
  const ident = resolveDiagnosticBuildIdentity()
  if (ident === 'stable' || ident === 'rc') {
    return ident
  }
  return 'dev'
}
