// Stage pinned Node and a content-addressed host script so Windows operations share verified bytes without replacing running clients' code.
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import type { NodeRuntimeTarget } from '../../../shared/node-runtime/node-runtime-pin'
import { ensureRemoteVshudNodeRuntime } from '../install/vshud-remote-node-runtime'
import {
  installVshudWindowsHostScript,
  vshudRemoteBaseDir
} from '../install/vshud-remote-windows-node'
import { materializeNodeRuntimeArchive } from '../../node-runtime/pinned-runtime-materializer'
import type { VshudHostTransport } from '../install/vshud-host-transport'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

export async function prepareWindowsVshudHost(options: {
  conn: VshudHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  serverTarget: NodeRuntimeTarget
  signal?: AbortSignal
}): Promise<void> {
  const baseDir = vshudRemoteBaseDir(options.host, options.remoteHome)
  await ensureRemoteVshudNodeRuntime({
    conn: options.conn,
    host: options.host,
    // The runtime store is a sibling of slots; only this synthetic slot's parent is used.
    slotDir: joinRemotePath(options.host, baseDir, 'vshud-host'),
    target: options.serverTarget,
    archivePath: () =>
      materializeNodeRuntimeArchive(
        options.serverTarget,
        join(getAppEnvironment().getPath('userData'), 'vshud-artifacts'),
        { signal: options.signal }
      ),
    signal: options.signal
  })
  await installVshudWindowsHostScript(options, baseDir)
}
