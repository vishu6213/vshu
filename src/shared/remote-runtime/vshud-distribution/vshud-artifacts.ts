/** Build, hash and install probe share this manifest; order determines the hash. Keep erasable-only TypeScript:
 * Node build scripts import via type stripping, which rejects enums, namespaces and parameter properties. */
// Bun-era slots only: kept so a client can still launch one for rollback (design D7.1 R5).
export const VSHUD_BUN_RUNTIME_FILENAME = 'bun-runtime'
export const VSHUD_WINDOWS_BUN_RUNTIME_FILENAME = 'bun-runtime.exe'
export const VSHUD_BUILD_TARGET_FILENAME = '.build-target'
export const VSHUD_WINDOWS_PROCESS_TREE_FILENAME = 'windows-process-tree.node'
/** native/windows-security: secure-file ACLs without spawning icacls. */
export const VSHUD_WINDOWS_SECURITY_FILENAME = 'windows-security.node'
/** native/windows-cli-launcher: cmd.exe and .ps1 shims cannot carry every argv intact. */
export const VSHUD_WINDOWS_CLI_LAUNCHER_FILENAME = 'bin/vshu.exe'
/** native/provider-exec: POSIX provider CLIs launch through it; there is no fallback launcher. */
export const VSHUD_PROVIDER_EXEC_FILENAME = 'bin/vshu-provider-exec'
/** Its path in a POSIX prebuild slot, compiled by the slot's own toolchain at its libc floor. */
export const VSHUD_PROVIDER_EXEC_SLOT_FILE = 'provider-exec/vshu-provider-exec'

/** Files every install path must mark executable; SFTP and plain copies drop the mode. */
export function isVshudExecutableArtifact(filename: string): boolean {
  return /(?:^|\/)(?:rg|spawn-helper|vshu-provider-exec|journal-file-lock)$/.test(filename)
}

export function vshudBunRuntimeFilename(target: string): string {
  return isWindowsTarget(target) ? VSHUD_WINDOWS_BUN_RUNTIME_FILENAME : VSHUD_BUN_RUNTIME_FILENAME
}

function isWindowsTarget(target: string): boolean {
  return target === 'win32' || target.startsWith('win32-')
}

/** A Node slot's server target (e.g. linux-x64-musl); `.build-target` would mark it as Bun. */
export const VSHUD_SERVER_TARGET_FILENAME = '.server-target'

/** The pinned Node executableSha256 enters the version hash here. Never ship .build-target in Node slots:
 * Bun-era selectors exit 78 without bun-runtime (design D7.1 R5). */
export const VSHUD_NODE_RUNTIME_MARKER_FILENAME = '.runtime-node'
/** Beside the slot dirs and shared across Vshu versions (design D2): `runtimes/node-<sha256>/bin/node`. */
export const VSHUD_RUNTIMES_DIRNAME = 'runtimes'
export const VSHUD_NODE_RUNTIME_DIR_PREFIX = 'node-'
export const VSHUD_NODE_RUNTIME_POSIX_EXECUTABLE = 'bin/node'
// Upstream's own name and layout: renaming node.exe is the masquerading pattern EDR scores.
export const VSHUD_NODE_RUNTIME_WINDOWS_EXECUTABLE = 'node.exe'

export function vshudNodeRuntimeExecutable(target: string): string {
  return isWindowsTarget(target)
    ? VSHUD_NODE_RUNTIME_WINDOWS_EXECUTABLE
    : VSHUD_NODE_RUNTIME_POSIX_EXECUTABLE
}

/** Slot-relative path segments of the runtime a slot's marker names. */
export function vshudNodeRuntimeRelativePath(target: string, executableSha256: string): string[] {
  return [
    '..',
    VSHUD_RUNTIMES_DIRNAME,
    `${VSHUD_NODE_RUNTIME_DIR_PREFIX}${executableSha256}`,
    ...vshudNodeRuntimeExecutable(target).split('/')
  ]
}

/** N-API level the slot addons are built for; equals SLOT_NAPI_VERSION in the prebuild script. */
export const VSHUD_ADDON_NAPI_VERSION = 8

export const VSHUD_NODE_PTY_DIR = 'node_modules/node-pty'
export const VSHUD_CLI_ENTRY_FILENAME = 'out/cli/index.js'
export const VSHUD_CLI_PACKAGE_FILENAME = 'out/package.json'
// Test files and sources stay out; these are every module the runtime path requires.
export const VSHUD_NODE_PTY_JS_ARTIFACTS = [
  'package.json',
  'lib/conpty_console_list_agent.js',
  'lib/eventEmitter2.js',
  'lib/index.js',
  'lib/interfaces.js',
  'lib/shared/conout.js',
  'lib/terminal.js',
  'lib/types.js',
  'lib/unixTerminal.js',
  'lib/utils.js',
  'lib/windowsConoutConnection.js',
  'lib/windowsPtyAgent.js',
  'lib/windowsTerminal.js',
  'lib/worker/conoutSocketWorker.js'
].map((file) => `${VSHUD_NODE_PTY_DIR}/${file}`)

/** The prebuild slot's files (config/scripts/vshud-prebuild-slot-contents.mjs), relative to build/Release. */
export function vshudNodePtySlotFiles(target: string): string[] {
  if (isWindowsTarget(target)) {
    return [
      'journal-file-lock.exe',
      'conpty.node',
      'conpty_console_list.node',
      'conpty/conpty.dll',
      'conpty/OpenConsole.exe',
      // node-pty's winpty backend, which it selects below Windows build 18309.
      'pty.node',
      'winpty.dll',
      'winpty-agent.exe'
    ]
  }
  return target.startsWith('darwin-')
    ? ['journal-file-lock', 'pty.node', 'spawn-helper']
    : ['journal-file-lock', 'pty.node']
}

export function vshudNodePtyNativeArtifacts(target: string): string[] {
  return vshudNodePtySlotFiles(target).map((file) => `${VSHUD_NODE_PTY_DIR}/build/Release/${file}`)
}

export const VSHUD_PARCEL_WATCHER_ENTRY = 'node_modules/@parcel/watcher/index.js'
export const VSHUD_PARCEL_WATCHER_NATIVE = 'node_modules/@parcel/watcher/watcher.node'
export const VSHUD_EMOJI_SHORTCODE_DATASET =
  'node_modules/emojibase-data/en/shortcodes/emojibase.json'
// linear-sdk.ts loads it through createRequire, which the server bundle cannot follow.
export const VSHUD_LINEAR_SDK_ENTRY = 'node_modules/@linear/sdk/index.js'

export const VSHUD_VERSION = '0.1.0'
export const VSHUD_LAUNCHER_FILENAME = 'vshud.js'
export const VSHUD_SERVER_ENTRY_FILENAME = 'vshud-server.js'

// Equals FOREIGN_SQLITE_READER_ENTRY_FILENAME; that module is not loadable under type stripping.
export const VSHUD_FOREIGN_SQLITE_READER_ENTRY = 'foreign-sqlite-reader-entry.js'
/** Worker thread that runs workspace port detection's probe commands off the event loop. */
export const VSHUD_PORT_SCAN_COMMAND_WORKER_ENTRY = 'port-scan-command-worker-entry.js'
// Equals AI_VAULT_SERVICE_ENTRY_FILENAME: the forked child that lists agent sessions.
export const VSHUD_SESSION_SCANNER_SERVICE_ENTRY = 'session-scanner-service-entry.js'
/** Worker thread SessionSearchWorkerClient loads; without it remote session search is unavailable. */
export const VSHUD_SESSION_SEARCH_WORKER_ENTRY = 'session-search-worker-entry.js'
// Equals COMPUTER_SIDECAR_ENTRY_FILENAME, and the desktop's out/main entry name.
export const VSHUD_COMPUTER_SIDECAR_ENTRY = 'computer-sidecar.js'
/** Plain scripts, one copy for every target: each platform's sidecar runs only its own. */
export const VSHUD_COMPUTER_USE_RUNTIME_ARTIFACTS = [
  'computer-use-linux/runtime.py',
  'computer-use-windows/runtime.ps1'
] as const

// Kept here because build-vshud.mjs imports this manifest directly under Node type stripping.
export const VSHUD_RIPGREP_ARTIFACTS = [
  'ripgrep/linux-x64/rg',
  'ripgrep/linux-arm64/rg',
  'ripgrep/darwin-x64/rg',
  'ripgrep/darwin-arm64/rg',
  'ripgrep/win32-x64/rg.exe',
  'ripgrep/win32-arm64/rg.exe'
] as const

/** Only the target's own ripgrep ships (design D2); both libcs share one static build. */
export function vshudRipgrepArtifact(target: string): string {
  const [platform, arch] = target.split('-')
  const artifact = VSHUD_RIPGREP_ARTIFACTS.find((candidate) =>
    candidate.startsWith(`ripgrep/${platform}-${arch}/`)
  )
  if (!artifact) {
    throw new Error(`vshud ships no ripgrep for ${target}`)
  }
  return artifact
}

/** Packaging-only references; deployed slots still contain their own verified binary. */
export function vshudTemplatePackagedRipgrep(
  schemaVersion: number,
  target: string,
  reference: unknown
): string | null {
  if (reference === undefined) {
    return null
  }
  if (schemaVersion !== 4 || reference !== true || target.startsWith('darwin-')) {
    throw new Error(`Invalid packaged ripgrep reference for ${target}`)
  }
  return vshudRipgrepArtifact(target)
}

export const VSHUD_RIPGREP_LICENSE_ARTIFACTS = [
  'ripgrep/licenses/JEMALLOC-COPYING',
  'ripgrep/licenses/LICENSE-MIT',
  'ripgrep/licenses/LLVM-LIBUNWIND-LICENSE.TXT',
  'ripgrep/licenses/MUSL-COPYRIGHT',
  'ripgrep/licenses/PCRE2-LICENCE.md',
  'ripgrep/licenses/README.md',
  'ripgrep/licenses/RUST-CRATE-NOTICES.txt',
  'ripgrep/licenses/SLJIT-LICENSE',
  'ripgrep/licenses/UNLICENSE'
] as const

/** The skill plugin native-chat agents load by path; mirrors resources/native-chat-visuals. */
export const VSHUD_NATIVE_CHAT_VISUALS_ARTIFACTS = [
  'native-chat-visuals/.claude-plugin/plugin.json',
  'native-chat-visuals/skills/vshu-chat-visuals/SKILL.md'
] as const

/** Phones load this page via mobileWeb.bundle.*; its content-addressed assets are listed only in the manifest. */
export const VSHUD_MOBILE_WEB_DIR = 'out/mobile-web'
export const VSHUD_MOBILE_WEB_MANIFEST = `${VSHUD_MOBILE_WEB_DIR}/manifest.json`

// Mirrors manifest-contract ASSET_PATH_PATTERN; cannot import under type stripping.
const MOBILE_WEB_ASSET_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/

/** A bundle-relative asset path that stays inside the page directory. */
export function isVshudMobileWebAssetPath(path: string): boolean {
  return (
    MOBILE_WEB_ASSET_PATH.test(path) &&
    !path.split('/').some((segment) => segment === '.' || segment === '..')
  )
}

/** Slot paths of every asset `manifestText` lists, their brotli copies and the host-only catalogs, sorted; throws rather than ship a partial page. */
export function vshudMobileWebAssetFilenames(manifestText: string): string[] {
  const manifest: unknown = JSON.parse(manifestText)
  const assets =
    manifest && typeof manifest === 'object' && 'assets' in manifest ? manifest.assets : undefined
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error(`${VSHUD_MOBILE_WEB_MANIFEST} lists no assets`)
  }
  const catalogs =
    manifest && typeof manifest === 'object' && 'catalogs' in manifest ? manifest.catalogs : []
  if (!Array.isArray(catalogs)) {
    throw new Error(`${VSHUD_MOBILE_WEB_MANIFEST} catalogs is not a list`)
  }
  const filenames = [...assets, ...catalogs].flatMap((asset: unknown) => {
    const entry = asset && typeof asset === 'object' ? asset : {}
    const path = 'path' in entry ? entry.path : undefined
    if (typeof path !== 'string' || !isVshudMobileWebAssetPath(path)) {
      throw new Error(`${VSHUD_MOBILE_WEB_MANIFEST} names an unsafe asset path: ${String(path)}`)
    }
    const slotPath = `${VSHUD_MOBILE_WEB_DIR}/${path}`
    // The asset's brotli copy, served to phones that inflate it; mirrors mobileWebBundleBrotliPath.
    return 'brotliByteLength' in entry ? [slotPath, `${slotPath}.br`] : [slotPath]
  })
  return filenames.sort(compareCodeUnits)
}

/** Code-unit order: page asset lists feed the install hash, so they must not depend on locale. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export type VshudArtifact = {
  filename: string
  /** Missing optional agent-browser means no headless browser, not a torn install; the remote probe must allow it. */
  optional?: boolean
}

export const VSHUD_ARTIFACTS: readonly VshudArtifact[] = [
  { filename: VSHUD_CLI_ENTRY_FILENAME },
  { filename: VSHUD_CLI_PACKAGE_FILENAME },
  { filename: VSHUD_LAUNCHER_FILENAME },
  { filename: VSHUD_SERVER_ENTRY_FILENAME },
  // Forked so a native @parcel/watcher fault kills the child, not the server.
  { filename: 'parcel-watcher-process-entry.js' },
  // Forked so PTYs outlive the runtime process; its absence makes every restart destructive.
  { filename: 'daemon-entry.js' },
  { filename: 'runtime-environment-store-worker-entry.js' },
  { filename: 'profile-state-writer-worker-entry.js' },
  { filename: 'profile-state-backup-worker-entry.js' },
  { filename: 'command-path-directory-worker-entry.js' },
  // Worker thread that reads other apps' SQLite (the OpenCode binder and history) off the event loop.
  { filename: VSHUD_FOREIGN_SQLITE_READER_ENTRY },
  { filename: 'journal-sql-worker-entry.js' },
  { filename: 'journal-sql-reader-entry.js' },
  // Terminal agent identity SQL runs in this worker thread, off the hook server's loop.
  { filename: 'agent-identity-worker-entry.js' },
  // Bot stores' SQL (items) runs in this worker thread, off the event loop.
  { filename: 'bots-db-worker-entry.js' },
  // Codex launch trust grants edit configs and the ownership ledger in this worker thread.
  { filename: 'codex-project-trust-worker-entry.js' },
  // Orchestration read queries (connector worker activity) run in this worker thread, off the event loop.
  { filename: 'orchestration-reader-entry.js' },
  { filename: VSHUD_PORT_SCAN_COMMAND_WORKER_ENTRY },
  // Forked so transcript parsing stays off the server's event loop.
  { filename: VSHUD_SESSION_SCANNER_SERVICE_ENTRY },
  // Session search queries run in a worker thread, also off the event loop.
  { filename: VSHUD_SESSION_SEARCH_WORKER_ENTRY },
  // Account worker threads keep CLI probes and Claude setup off the event loop.
  { filename: 'worker-thread-child-process-entry.js' },
  { filename: 'claude-profile-setup-worker-entry.js' },
  // Claude fork and rewind copy a transcript in a worker thread, off the event loop.
  { filename: 'claude-conversation-fork-worker-entry.js' },
  // Stats & Usage scans this host's agent transcripts in a worker thread, off the event loop.
  { filename: 'usage-scan-worker-entry.js' },
  // Dictation loads the recognizer named by vshu serve (#31174).
  { filename: 'stt-worker.js' },
  // Reads a Drive PDF's text off the event loop for `vshu drive read`.
  { filename: 'google-pdf-text-worker-entry.js' },
  // The forked computer sidecar finds platform runtimes beside itself (#31777).
  { filename: VSHUD_COMPUTER_SIDECAR_ENTRY },
  ...VSHUD_COMPUTER_USE_RUNTIME_ARTIFACTS.map((filename) => ({ filename })),
  // Target-specific even when the JavaScript bundle is shared across packaged slots.
  { filename: VSHUD_SERVER_TARGET_FILENAME },
  // vshud never depends on a host runtime or host-installed native module.
  { filename: VSHUD_NODE_RUNTIME_MARKER_FILENAME },
  { filename: VSHUD_PARCEL_WATCHER_ENTRY },
  { filename: VSHUD_PARCEL_WATCHER_NATIVE },
  { filename: VSHUD_EMOJI_SHORTCODE_DATASET },
  { filename: VSHUD_LINEAR_SDK_ENTRY },
  ...VSHUD_NODE_PTY_JS_ARTIFACTS.map((filename) => ({ filename })),
  ...VSHUD_RIPGREP_LICENSE_ARTIFACTS.map((filename) => ({ filename })),
  ...VSHUD_NATIVE_CHAT_VISUALS_ARTIFACTS.map((filename) => ({ filename })),
  // Missing page suppresses mobileWeb.bundle.v1, leaving paired phones without a page.
  { filename: VSHUD_MOBILE_WEB_MANIFEST }
]

/** Written after the artifacts, so it is never an input to its own hash. */
export const VSHUD_VERSION_FILENAME = '.version'
export const VSHUD_TEMPLATE_MANIFEST_FILENAME = 'vshud-template.json'
export const VSHUD_TEMPLATE_TARGETS_DIR = 'targets'

/** Written last by the installer; its absence means a torn install. */
export const VSHUD_INSTALL_COMPLETE_FILENAME = '.install-complete'

/** Slot files in hash order for <os>-<arch>[-<libc>]; mobileWebAssets comes from the slot’s own page manifest. */
export function vshudArtifactFilenames(
  target: string,
  mobileWebAssets: readonly string[]
): string[] {
  const filenames = VSHUD_ARTIFACTS.filter((artifact) => !artifact.optional).map(
    (artifact) => artifact.filename
  )
  filenames.push(...vshudNodePtyNativeArtifacts(target), vshudRipgrepArtifact(target))
  if (isWindowsTarget(target)) {
    filenames.push(
      VSHUD_WINDOWS_PROCESS_TREE_FILENAME,
      VSHUD_WINDOWS_SECURITY_FILENAME,
      VSHUD_WINDOWS_CLI_LAUNCHER_FILENAME
    )
  } else {
    filenames.push(VSHUD_PROVIDER_EXEC_FILENAME)
  }
  filenames.push(...mobileWebAssets)
  return filenames
}

/** Files shared by every template target; the rest live under `targets/<target>/`. */
export function vshudTemplateCommonFilenames(mobileWebAssets: readonly string[]): string[] {
  const filenames = VSHUD_ARTIFACTS.filter(
    (artifact) =>
      !artifact.optional &&
      artifact.filename !== VSHUD_SERVER_TARGET_FILENAME &&
      artifact.filename !== VSHUD_NODE_RUNTIME_MARKER_FILENAME &&
      artifact.filename !== VSHUD_PARCEL_WATCHER_NATIVE
  ).map((artifact) => artifact.filename)
  filenames.push(...mobileWebAssets)
  return filenames
}

/** Files stored under the template's `targets/<target>/`, at their slot-relative paths. */
export function vshudTemplateTargetFilenames(target: string): string[] {
  const common = new Set(vshudTemplateCommonFilenames([]))
  return vshudArtifactFilenames(target, []).filter((filename) => !common.has(filename))
}
