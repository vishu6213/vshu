import { describe, expect, it } from 'vitest'
import {
  parseVshudActivationTransaction,
  planVshudTransactionRecovery,
  serializeVshudActivationTransaction
} from '../activation/vshud-activation-transaction'
import {
  committedVshudDecommissionRecord,
  createVshudDecommissionTransaction,
  withVshudDecommissionProcessExited,
  withVshudDecommissionStopDispatched
} from './vshud-decommission-transaction'
import { FakeVshudHost, NEW } from '../activation/vshud-activation-host-test-harness'
import type { VshudManagedStopRequest } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'

const T = new Date('2026-02-02T00:00:00.000Z')
const ID = '7f1c2a7e-6c1b-4a8e-9f0e-0a1b2c3d4e5f'
const before = { ...FakeVshudHost.newRecord(), active: NEW }
const prepared = createVshudDecommissionTransaction({
  transactionId: ID,
  recordBefore: before,
  now: T
})
const request: VshudManagedStopRequest = {
  schemaVersion: 1,
  transactionId: ID,
  version: NEW,
  runtimeId: 'runtime-1',
  instance: { pid: 42, startedAtMs: 5, nonce: 'nonce', lockPath: '/home/u/.vshu/vshud.lock' },
  retireIdleDaemon: true
}
const dispatched = withVshudDecommissionStopDispatched(prepared, request, T)
const exited = withVshudDecommissionProcessExited(dispatched, T)

describe('the decommission journal entry', () => {
  it('journals a recordAfter released desktops still read, and commits the app version', () => {
    // Frozen validation from released desktops must continue accepting new stop journals.
    const releasedDefect = (journal: typeof prepared): string | null => {
      const b = journal.recordBefore
      const deactivated = {
        schemaVersion: 1,
        active: null,
        previous: b.active,
        activatedAt: null,
        snapshot: null
      }
      return `${JSON.stringify(journal.recordAfter, null, 2)}\n` ===
        `${JSON.stringify(deactivated, null, 2)}\n`
        ? null
        : 'recordAfter is not the deactivated recordBefore'
    }
    const versionedBefore = { ...before, activeAppVersion: '1.5.0', rolledBackFrom: '0.9.0+ff01' }
    const versioned = createVshudDecommissionTransaction({
      transactionId: ID,
      recordBefore: versionedBefore,
      now: T
    })
    const journal = JSON.parse(serializeVshudActivationTransaction(versioned))
    expect(releasedDefect(journal)).toBeNull()
    const interrupted = withVshudDecommissionProcessExited(
      withVshudDecommissionStopDispatched(versioned, request, T),
      T
    )
    const stored = parseVshudActivationTransaction(serializeVshudActivationTransaction(interrupted))
    if (stored.state !== 'ok') {
      throw new Error('Expected the persisted decommission transaction to be readable')
    }
    expect(planVshudTransactionRecovery(stored.transaction, versionedBefore)).toMatchObject({
      action: 'confirm-decommissioned',
      record: { active: null, activeAppVersion: '1.5.0', rolledBackFrom: '0.9.0+ff01' }
    })
    expect(committedVshudDecommissionRecord(versioned)).toMatchObject({
      previous: NEW,
      activeAppVersion: '1.5.0'
    })
  })

  it.each([
    ['a dispatched phase without its request', { ...dispatched, request: null }],
    ['a request before dispatch', { ...prepared, request }],
    [
      'a request for another transaction',
      {
        ...dispatched,
        request: { ...request, transactionId: '5a7e1f0c-3b2d-4e6f-9a8b-7c6d5e4f3a2b' }
      }
    ],
    [
      'a request for another version',
      { ...dispatched, request: { ...request, version: '0.9.0+ff01' } }
    ],
    ['a recordAfter that still serves', { ...prepared, recordAfter: before }]
  ])('reads %s as unreadable, keeping the fence', (_name, transaction) => {
    expect(parseVshudActivationTransaction(JSON.stringify(transaction))).toMatchObject({
      state: 'unreadable'
    })
  })

  it('plans recovery from what the host is known to have done', () => {
    const after = prepared.recordAfter
    expect(planVshudTransactionRecovery(prepared, before)).toEqual({
      action: 'keep-serving',
      version: NEW
    })
    expect(planVshudTransactionRecovery(dispatched, before)).toEqual({
      action: 'resume-stop',
      request,
      record: after
    })
    expect(planVshudTransactionRecovery(exited, before)).toEqual({
      action: 'confirm-decommissioned',
      version: NEW,
      record: after
    })
    expect(planVshudTransactionRecovery(dispatched, after)).toEqual({
      action: 'confirm-decommissioned',
      version: NEW,
      record: null
    })
    expect(planVshudTransactionRecovery(dispatched, { ...after, previous: null })).toMatchObject({
      action: 'refuse'
    })
  })
})
