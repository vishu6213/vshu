/** How this copy of Vshu was installed; decides the last step the user takes to delete the app. */
export type VshuUninstallInstallKind =
  | 'mac-app'
  | 'mac-homebrew'
  | 'windows-installer'
  | 'linux-appimage'
  | 'linux-package'
  | 'unknown'

/** One part of the cleanup, run in this order. */
export type VshuUninstallStep =
  | 'agent-hooks'
  | 'cli-command'
  | 'background-service'
  | 'hook-scripts'
  | 'ssh-hosts'
  | 'terminal-daemon'

export const VSHU_UNINSTALL_STEPS: readonly VshuUninstallStep[] = [
  'agent-hooks',
  'cli-command',
  'background-service',
  'hook-scripts',
  'ssh-hosts',
  // Last, so no other step depends on it; it ends the user's open terminals.
  'terminal-daemon'
]

/**
 * `kept-shared`: another Vshu build still uses it, so it stays.
 * `needs-user`: Vshu can't do it from here (an offline SSH host); the entry names what to run.
 */
export type VshuUninstallEntryState = 'present' | 'removed' | 'kept-shared' | 'needs-user' | 'error'

/** A file Vshu changes; `vshuData` is set when it sits in Vshu's own data folder. */
export type VshuUninstallPath = {
  /** The full path, with the home folder shown as `~`. */
  path: string
  /** `relative` is the part after the account home or the data folder. */
  vshuData: { kind: 'codex-account' | 'app-data'; relative: string } | null
}

export type VshuUninstallAgentEntry = {
  agent: string
  /** Every file Vshu changes or deletes for this agent. */
  paths: VshuUninstallPath[]
  state: VshuUninstallEntryState
  /** One short line, e.g. "Permission denied". */
  detail: string | null
}

export type VshuUninstallHostEntry = {
  hostId: string
  label: string
  connected: boolean
  state: VshuUninstallEntryState
  detail: string | null
}

export type VshuUninstallSimpleEntry = {
  /** What the row shows on the right: a path, a command name, or a service label. */
  location: string
  state: VshuUninstallEntryState
  detail: string | null
}

/** What would change, and after a step runs, what did. Steps with nothing to do are null or empty. */
export type VshuUninstallPlan = {
  installKind: VshuUninstallInstallKind
  agents: VshuUninstallAgentEntry[]
  cliCommand: (VshuUninstallSimpleEntry & { commandName: string }) | null
  backgroundService: VshuUninstallSimpleEntry | null
  hookScripts: VshuUninstallSimpleEntry | null
  hosts: VshuUninstallHostEntry[]
  /** This machine's terminal daemon, present only while one is running; stopping it ends open terminals. */
  terminalDaemon: VshuUninstallSimpleEntry | null
  /** Set when another Vshu build (stable, RC or dev) still uses the shared hooks. */
  otherVshuBuildName: string | null
  /** The app bundle, AppImage or install folder to reveal, when there is one. */
  appPath: string | null
  /** The command that deletes the app when the OS needs one (Homebrew, apt, dnf). */
  removeAppCommand: string | null
}

export type VshuUninstallRunStepArgs = {
  step: VshuUninstallStep
  /** Retry only these agents or hosts. */
  only?: string[]
}

export type VshuUninstallFinishAction = 'quit' | 'reveal-app' | 'open-windows-uninstaller'
