// CI release builds substitute telemetry credentials; contributor builds use null and console-mirror only.
// No runtime env fallback: shell exports must not enable telemetry transmission.
declare const VSHU_BUILD_IDENTITY: 'stable' | 'rc' | null
declare const VSHU_POSTHOG_WRITE_KEY: string | null

// CI supplies the diagnostics token endpoint; null disables upload in contributor builds.
// VSHU_DIAGNOSTICS_TOKEN_URL overrides it for developers testing packaged builds against staging.
declare const VSHU_DIAGNOSTICS_TOKEN_URL: string | null

// Full commit the build was made from (`git rev-parse HEAD`); official skill installs pin to it.
declare const VSHU_BUILD_COMMIT: string

// VSHU_LAYOUT_OWNER is declared and read in one place: src/shared/workspace-layout/layout-owner-switch.ts.
