// Consume slot stop files; retain validated instance-bound requests as evidence until exit is proven.
import { unlinkSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  VSHUD_STOP_REQUEST_FILENAME,
  type VshudManagedStopContext,
  type VshudManagedStopRequest
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import {
  vshudManagedStopRequestPath,
  validateVshudManagedStopRequest
} from './vshud-managed-stop-request'
import { claimVshudManagedStopDecision } from './vshud-managed-stop-decision'
import { withdrawVshudManagedStopRequest } from './vshud-managed-stop-cancellation'
import { hasErrorCode } from '../../../daemon/endpoint/identity/daemon-process-inspection'

export type VshudStopRequestListener = { close(): void }

const DEFAULT_POLL_INTERVAL_MS = 1_000

function listenForRequest<T>(
  requestPath: string,
  consume: (path: string) => T | null,
  onRequest: (request: T) => void,
  pollIntervalMs: number
): VshudStopRequestListener {
  let closed = false
  let lastFailure: string | null = null
  const check = (): void => {
    if (closed) {
      return
    }
    let request: T | null
    try {
      request = consume(requestPath)
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        const failure = error instanceof Error ? error.message : String(error)
        if (failure !== lastFailure) {
          lastFailure = failure
          console.error(`[vshud] refused stop request at ${requestPath}:`, error)
        }
      }
      return
    }
    if (request === null) {
      return
    }
    closed = true
    stop()
    onRequest(request)
  }
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dirname(requestPath), (_event, changed) => {
      if (!changed || basename(String(changed)) === basename(requestPath)) {
        check()
      }
    })
    watcher.on('error', (error) => console.error('[vshud] stop-request watcher failed:', error))
    watcher.unref()
  } catch (error) {
    // Polling still delivers requests when filesystem watching fails.
    console.error('[vshud] stop-request watcher could not start:', error)
  }
  const poll = setInterval(check, pollIntervalMs)
  poll.unref()
  const stop = (): void => {
    watcher?.close()
    clearInterval(poll)
  }
  check()
  return {
    close: () => {
      closed = true
      stop()
    }
  }
}

export function installVshudStopRequestListeners(
  onRequest: () => void,
  options: {
    installRoot: string
    managedStop?: VshudManagedStopContext
    /** Best-effort preparation runs before shutdown and cannot prevent it. */
    beforeManagedStop?: (request: VshudManagedStopRequest) => Promise<void>
    pollIntervalMs?: number
  }
): VshudStopRequestListener {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  // Initial checks can close listeners synchronously before setup returns.
  const listeners: VshudStopRequestListener[] = []
  const close = (): void => {
    for (const listener of listeners) {
      listener.close()
    }
  }
  listeners.push(
    listenForRequest(
      join(options.installRoot, VSHUD_STOP_REQUEST_FILENAME),
      (path) => {
        unlinkSync(path)
        return true
      },
      () => onRequest(),
      pollIntervalMs
    )
  )
  const managedStop = options.managedStop
  if (managedStop) {
    const prepare = options.beforeManagedStop ?? (async () => {})
    listeners.push(
      listenForRequest(
        vshudManagedStopRequestPath(managedStop.instance),
        (path) => {
          const request = validateVshudManagedStopRequest(managedStop, path)
          if (claimVshudManagedStopDecision(request, 'dispatched') === 'canceled') {
            // Withdraw canceled requests so later transactions can publish their own.
            withdrawVshudManagedStopRequest(request)
            throw new Error('vshud_managed_stop_canceled')
          }
          return request
        },
        (request) => {
          close()
          void prepare(request)
            .catch((error: unknown) =>
              console.error('[vshud] managed stop preparation failed:', error)
            )
            .finally(onRequest)
        },
        pollIntervalMs
      )
    )
  }
  return { close }
}
