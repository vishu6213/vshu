import type { BackendCoreHost } from './core-runtime'
import type { VshudHandle } from '../vshud/serve-startup/vshud-start-contract'
import type { BackendCoreProfileShutdown } from './core-profile-shutdown'
import { prepareBackendDaemon } from './core-daemon-startup'
import { prepareWorktreeRemovalsForStore } from '../workspaces/removal/worktree-removal-records-load'
import { worktreeRemovalLifetime } from '../workspaces/removal/worktree-removal-lifetime'
import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host/execution-host'
import {
  describeVshudBindExposure,
  resolveVshudBindHost
} from '../../shared/remote-runtime/vshud-lifecycle/vshud-bind-address'
import {
  startVshudAgentSessionRecordStoreOpen,
  stopVshudStructuredAgentSessions
} from '../vshud/host-lifecycle/vshud-lifecycle'
import type { BackendServiceCleanup } from './service-composition'
import { bindVshudStopTerminalAdmission } from '../vshud/host-lifecycle/managed-stop/vshud-stop-terminal-admission'
import { beginVshudIdleExit } from '../vshud/host-lifecycle/idle-exit/vshud-managed-idle-exit-host'
import {
  vshudSchedulersKeepHostBusy,
  startVshudSchedulers
} from '../vshud/host-runtime/vshud-schedulers'
import {
  changedAiVaultSearchSettings,
  type AiVaultSearchSettings
} from '../../shared/ai-vault/search/ai-vault-search-settings'
import { adoptWslHostLoginEnvironmentLogged } from '../vshud/host-runtime/vshud-wsl-host-login-environment'
import { createVshudStartupTiming } from '../vshud/diagnostics/vshud-startup-timing'
import { VSHU_LAYOUT_OWNER_IS_MAIN } from '../../shared/workspace-layout/layout-owner-switch'
import { restoreVshudTerminalAuthority } from '../vshud/host-runtime/vshud-restored-terminal-authority'
import { installVshudFeatureReadiness } from '../runtime/rpc/startup/vshud-readiness'
import { isAgentStatusHooksEnabled } from '../../shared/agent-hook-listener/configuration/agent-status-hooks-setting'
import { installVshudConnectorHost, installVshudRelayAndAccount } from '../vshud/vshud-vshu-account'

export async function activateBackendRuntime(
  host: BackendCoreHost,
  registerCleanup: (cleanup: BackendServiceCleanup) => void,
  profileShutdown: BackendCoreProfileShutdown,
  setObservabilityCleanup: (close: () => Promise<void>) => void
): Promise<Pick<VshudHandle, 'readiness'>> {
  const { options } = host
  const { time: timed, report: reportStartupTiming } = createVshudStartupTiming()
  // Overlap login-shell probing with imports and store startup.
  const loginEnvironment = adoptWslHostLoginEnvironmentLogged()
  const { ready: daemonStartup } = await prepareBackendDaemon(
    loginEnvironment,
    timed,
    registerCleanup
  )
  const { VshuRuntimeService } = await import('../runtime/vshu-runtime')
  const { createVshudRuntimeRpcServer } = await import('../vshud/host-runtime/vshud-runtime-rpc')
  const { registerHeadlessPtyRuntime } = await import('../ipc/pty/register-headless-runtime')
  const { getLocalPtyProvider } = await import('../ipc/pty/provider/registry')
  const { installVshudObservability } = await import('../vshud/diagnostics/vshud-observability')
  setObservabilityCleanup(installVshudObservability())
  const { ServeReadinessPublisher } = await import('../server/serve-readiness')
  const { servePublishMode } = await import('../server/serve-pairing-readiness')
  const { buildVshudServeReadiness } = await import('../vshud/serve-startup/vshud-serve-readiness')
  const { createVshudProfileStateStartup } =
    await import('../vshud/profile-state/vshud-profile-state-startup')
  const { daemonOwnsFreshPersistentPtys } =
    await import('../daemon/providers/lifecycle/daemon-provider-state')
  const { resolveDaemonSessionScrollbackRows } =
    await import('../daemon/sessions/daemon-session-scrollback-window')
  const { collectVshudHealth } = await import('../vshud/diagnostics/vshud-health')
  const { agentHookServer } = await import('../agent-hooks/server/agent-hook-server')
  await import('../agent-hooks/installation/managed-agent-hook-controls')
  const { agentHookRuntimeDeps } = await import('../agent-hooks/runtime/agent-hook-runtime-deps')
  const { installHookStatusSessionTabsRepublish } =
    await import('../agent-hooks/runtime/hook-status-session-tabs-republish')
  const { startVshudAgentHookServer, startVshudManagedAgentHooks, stopVshudAgentListeners } =
    await import('../vshud/host-runtime/vshud-managed-agent-hooks')
  const { AgentStatusObservedPaneIdentities, AgentStatusObservedPaneIdentityCapture } =
    await import('../runtime/terminal/identity/agent-status-observed-pane-identity')

  const { disposeWatcherProcessAndWait } =
    await import('../ipc/filesystem/watcher-process/parcel-watcher-process')

  let uninstallHookStatusRepublish = (): void => {}
  let uninstallObservedStatusIdentity = (): void => {}
  // Cleanups run in reverse: RPC, then recovery and watchers, then the final flush; the daemon
  // disconnect, registered above, runs last.
  registerCleanup(() => stopVshudAgentListeners(agentHookServer))
  registerCleanup(() => uninstallHookStatusRepublish())
  registerCleanup(() => uninstallObservedStatusIdentity())
  registerCleanup(profileShutdown.finalize)
  registerCleanup(stopVshudStructuredAgentSessions)
  registerCleanup(() => disposeWatcherProcessAndWait())
  const { startVshudDesktopPushService } = await import('../vshud/host-runtime/vshud-desktop-push')

  const runtimeUserDataPath = getAppEnvironment().getPath('userData')
  const { startEventLoopDelayProbe } = await import('../diagnostics/event-loop-delay-probe')
  startEventLoopDelayProbe('vshud', runtimeUserDataPath)
  await timed('cli-launcher', () => host.prepareCliLauncher()).catch((error: unknown) => {
    console.warn('[vshud] Could not prepare the profile CLI launcher', error)
  })
  const idleExitStartup = beginVshudIdleExit(runtimeUserDataPath)
  const { applyVshudSessionScannerIdleTimeout } =
    await import('../vshud/host-runtime/vshud-session-scanner-idle')
  await applyVshudSessionScannerIdleTimeout()
  // Initialize sealing before Store load unseals protected settings.
  await timed('secret-store', () => host.prepareSecrets(runtimeUserDataPath))
  const { store: profileStore, authority: profileStateAuthority } = await timed('profile', () =>
    createVshudProfileStateStartup(runtimeUserDataPath)
  )
  profileShutdown.store = profileStore
  const { installVshudUsageService } = await import('../vshud/host-runtime/vshud-usage-service')
  const usageClients = installVshudUsageService(profileStore, runtimeUserDataPath, registerCleanup)
  registerCleanup(() => worktreeRemovalLifetime.close())
  await timed('worktree-removals', () => prepareWorktreeRemovalsForStore(profileStore))
  const observedPaneIdentities = new AgentStatusObservedPaneIdentities()
  const observedStatusCapture = new AgentStatusObservedPaneIdentityCapture(observedPaneIdentities)
  uninstallObservedStatusIdentity = agentHookServer.subscribeEnrichedStatus((enriched) =>
    observedStatusCapture.observe(enriched)
  )
  // Subscribe before hooks start so early turns are counted.
  const { startVshudStats } = await import('../vshud/host-runtime/vshud-stats')
  const stats = startVshudStats(runtimeUserDataPath, agentHookServer, registerCleanup)
  await startVshudAgentHookServer(agentHookServer, {
    env: 'production',
    userDataPath: runtimeUserDataPath,
    statusHooksEnabled: isAgentStatusHooksEnabled(profileStore.getSettings())
  })

  // Reconcile, daemon and runtime all consume this environment.
  await timed('login-env-wait', () => loginEnvironment)
  const managedAgentHooks = startVshudManagedAgentHooks(
    profileStore,
    (enabled) => agentHookServer.setStatusHooksEnabled(enabled),
    registerCleanup
  )

  // Boots the chat writer during the daemon wait, after login env; restoration consumes this attempt.
  const chatJournal = await startVshudAgentSessionRecordStoreOpen(profileStore)

  // Install the daemon provider before PTY handlers can route their first call.
  await daemonStartup

  // Runtime constructor callbacks use this index only after it is installed.
  let sessionSearch: { apply(settings: AiVaultSearchSettings): void; dispose(): void } | null = null

  const { vshudCodexAccountHomes } =
    await import('../vshud/account-launch/vshud-codex-account-homes')
  const codexAccountHomes = vshudCodexAccountHomes(
    () => profileStore.getSettings(),
    registerCleanup
  )

  // Gates open where each phase finishes today; RPC starts after all of them.
  const featureReadiness = installVshudFeatureReadiness()
  const { createVshudAccountServices } =
    await import('../vshud/account-launch/vshud-account-services')
  const accountLaunch = createVshudAccountServices({
    store: profileStore,
    setClaudeStatusLineListener: (listener) =>
      agentHookServer.setClaudeStatusLineListener(listener),
    registerCleanup,
    clientCodexHomes: codexAccountHomes
  })

  const { loadAgentSessionClaimSigner } =
    await import('../runtime/agent-session/ownership/agent-session-claim-identity')
  const { createVshudPairedEnvironmentOptions } =
    await import('../vshud/host-runtime/vshud-paired-environment-options')
  const pairedEnvironments = createVshudPairedEnvironmentOptions()
  const runtime = new VshuRuntimeService(profileStore, stats, {
    legacyStructuredSessionTabIds: chatJournal.open.legacySessionTabIds,
    // Persistent signatures let restarted runtimes adopt PTYs owned before restart.
    agentSessionClaimSigner: loadAgentSessionClaimSigner(runtimeUserDataPath, runtimeUserDataPath),
    getAdditionalAiVaultCodexHomePaths: () => [
      ...codexAccountHomes.listSessionHomes(),
      ...(accountLaunch?.listCodexSessionHomes() ?? [])
    ],
    // WSL must retain desktop-pushed CODEX_HOME instead of host-selected resolvers.
    ...accountLaunch?.runtimeDeps,
    ...agentHookRuntimeDeps(agentHookServer, observedPaneIdentities, () =>
      profileStore.getSettings()
    ),
    // Resolve lazily because daemon swaps replace the provider after construction.
    getLocalProvider: () => getLocalPtyProvider(),
    ...pairedEnvironments.runtimeOptions,
    // Read current daemon ownership; failed/degraded launch cannot claim fresh PTY persistence.
    canRecoverPersistentLocalPtys: () => daemonOwnsFreshPersistentPtys(),
    // Node hosts cannot promote into desktop windows; override the constructor’s openable default.
    getDesktopWindowStatus: () => 'blocked',
    // No renderer reveals from this model; it keeps the daemon's live window, which deeper snapshot reads ask first.
    headlessTerminalScrollbackRows: resolveDaemonSessionScrollbackRows(),
    // Unchanged settings would reconstruct a healthy search index; deduplicate before apply.
    applySessionSearchSettings: (before, after) => {
      const next = changedAiVaultSearchSettings(before, after)
      if (next) {
        sessionSearch?.apply(next)
      }
    }
  })
  profileShutdown.paneGrids = runtime
  profileShutdown.paintLedger = runtime
  runtime.beginStructuredAgentSessionStartupOpen(chatJournal.maintenanceAfter, chatJournal.open)

  const { installFirstWorkRenameHookSubscription } =
    await import('../agent-hooks/first-work/first-work-rename-hook-subscription')
  const { firstWorkRenameDeps } =
    await import('../agent-hooks/first-work/first-work-rename-runtime')
  registerCleanup(
    installFirstWorkRenameHookSubscription(firstWorkRenameDeps(profileStore, runtime))
  )

  accountLaunch?.attachToRuntime(runtime)
  const { wireGitHubIssueLinkTitleFill } =
    await import('../github/workspace-links/github-issue-link-title-wiring')
  registerCleanup(wireGitHubIssueLinkTitleFill(profileStore, runtime))
  const { installVshudEmulatorBridge } = await import('../vshud/host-runtime/vshud-emulator-bridge')
  installVshudEmulatorBridge(runtime, registerCleanup)
  const relay = await installVshudRelayAndAccount(runtime, registerCleanup)

  // Restore prior desktop-pushed account selection before automations or CLI launches.
  const { restoreVshudHostAccountLaunchEnv } =
    await import('../vshud/account-launch/vshud-host-account-launch-env-store')
  restoreVshudHostAccountLaunchEnv(runtime, runtimeUserDataPath)
  featureReadiness.open('accounts')

  const { installVshudSessionSearchService } =
    await import('../vshud/host-runtime/vshud-session-search')
  const { sessionSearchScopeCatalogFromStore } =
    await import('../ai-vault-search/scope/session-search-store-scope-catalog')
  sessionSearch = await installVshudSessionSearchService({
    userDataPath: runtimeUserDataPath,
    getSettings: () => profileStore.getSettings(),
    // Workspace/Project scopes resolve through this host's own registrations, read per search.
    getScopeCatalog: () => sessionSearchScopeCatalogFromStore(profileStore, LOCAL_EXECUTION_HOST_ID)
  })
  getAppEnvironment().onWillQuit(() => sessionSearch?.dispose())
  featureReadiness.open('sessionSearch')

  const { startAgentStateRulesLiveUpdates } =
    await import('../runtime/agent-state-rules/agent-state-rules-live-update')
  startAgentStateRulesLiveUpdates(profileStore, (rules) =>
    console.info(`[vshud] agent state rules ${rules.version} (${rules.source})`)
  )
  // Paired phones dictate through this host; keep its model loaded the same way the desktop does.
  const { startSpeechModelWarmup } = await import('../speech/speech-model-warmup')
  startSpeechModelWarmup(profileStore)
  if (VSHU_LAYOUT_OWNER_IS_MAIN) {
    const { repairDuplicatePtyPanesOnStart } =
      await import('../runtime/terminal/identity/moved-pane-owner-rekey')
    // Wait behind earlier writes and persist repair before reconciliation/RPC admission.
    await repairDuplicatePtyPanesOnStart(profileStore, runtime)
  }

  // Status changes must republish session.tabs to paired clients.
  uninstallHookStatusRepublish = installHookStatusSessionTabsRepublish(
    agentHookServer,
    () => runtime
  )
  registerCleanup(runtime.attachAgentStatusStore(agentHookServer))

  // Headless registration threads Store into persistence; account homes prefer client then host selection.
  // WSL has no host selection and keeps the desktop-prepared environment.
  await registerHeadlessPtyRuntime(
    runtime,
    async (target, launchEnv, context) =>
      (await codexAccountHomes.selectLaunchHome(target, launchEnv, context)) ??
      (accountLaunch ? accountLaunch.prepareCodexHome(target, launchEnv, context) : null),
    () => profileStore.getSettings(),
    accountLaunch?.prepareClaudeAuth,
    profileStore,
    accountLaunch?.prepareCodexSessionResume
  )

  // Recover browser/orchestration authority before clients attach to the runtime graph.
  runtime.rehydrateClientHostedBrowserPages()

  await restoreVshudTerminalAuthority(runtime, timed, featureReadiness)
  runtime.agentTransitions.seedRestoredRows()
  void runtime.sidebarFacts?.reconcileSortStampTiers(getLocalPtyProvider())

  // Run after RPC stops; later dismissal records save synchronously until exit.
  registerCleanup(() => runtime.closeNotificationDismissals())
  // Stop recovery retries before final profile flush.
  registerCleanup(() => runtime.stopLegacyWorkerTerminalRecovery())

  // Recovery establishes terminal/dispatch identities before fencing observations.
  observedStatusCapture.attach(runtime)
  agentHookServer.setCliWriterExecutionMatcher(observedPaneIdentities, runtime)
  agentHookServer.setClaudePermissionHolds(runtime.terminalWorkerApprovals)
  // First RPC clients must see a fully published graph.
  const { publishHeadlessRuntimeGraph } =
    await import('../runtime/session-graph/headless-runtime-graph')
  publishHeadlessRuntimeGraph(runtime)
  // Only the runtime can identify running shells and install deferred migrated history.
  void runtime.installPendingVshudMigrationShellHistory().catch((error: unknown) => {
    console.error('[vshud-migration] installing pending shell history failed:', error)
  })

  const connector = await installVshudConnectorHost(runtime, profileStore, registerCleanup)

  const bindHost = resolveVshudBindHost(options.bind)
  bindVshudStopTerminalAdmission(runtime.terminalUpdateAdmission)
  const rpc = createVshudRuntimeRpcServer(runtime, runtimeUserDataPath, options, bindHost)
  pairedEnvironments.bindRpc(rpc)
  runtime.setAgentSenderPeerKey(() => rpc.getE2EEPublicKey())
  // Stop RPC before cleanup can tear down writers and runtime state.
  registerCleanup(() => rpc.stop())
  await timed('rpc', () => rpc.start())
  worktreeRemovalLifetime.resume(() => runtime.finishInterruptedWorktreeRemovals())
  startVshudSchedulers(runtime, profileStore, usageClients, registerCleanup)
  connector.connect()
  relay.start(rpc)
  startVshudDesktopPushService(runtime, rpc)
  console.error(`[vshud] ${describeVshudBindExposure(bindHost)}`)

  const readiness = await buildVshudServeReadiness({
    options,
    runtimeId: runtime.getRuntimeId(),
    rpc,
    collectHealth: () =>
      collectVshudHealth(
        getAppEnvironment().getVersion(),
        profileStateAuthority,
        idleExitStartup.previousIdleStop
      )
  })

  await new ServeReadinessPublisher().publish(readiness, servePublishMode(options))
  // Background chat-journal maintenance, CI-line watches and runtime release reclaim start once this host is serving.
  chatJournal.serving()
  runtime.startPullRequestWatches({ admit: true })
  const { reclaimManagedRuntimeReleasesAtLaunch, startManagedRuntimeAutoUpdates } =
    await import('../runtime/rpc/methods/host-management/managed-runtime-install')
  reclaimManagedRuntimeReleasesAtLaunch(runtime)
  startManagedRuntimeAutoUpdates()
  reportStartupTiming()
  managedAgentHooks.readinessPublished()

  await idleExitStartup.start({
    rpc,
    agentStates: () => agentHookServer.getStatusSnapshot(),
    hasStagedMigration: () => profileStore.hasStagedVshudMigrationCatalog(),
    automationsBusy: () => vshudSchedulersKeepHostBusy(runtime, profileStore),
    emulatorsBusy: async () =>
      (await runtime.getEmulatorBridge()?.hasLiveManagedSessions()) ?? false,
    registerCleanup
  })
  return { readiness }
}
