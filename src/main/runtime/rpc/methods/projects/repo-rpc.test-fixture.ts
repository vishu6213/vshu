import { RpcDispatcher } from '../../dispatcher'
import type { RpcRequest } from '../../core'
import type { VshuRuntimeService } from '../../../vshu-runtime'
import { REPO_METHODS } from './repo'

export function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

export function repoDispatcher(
  runtime: Pick<VshuRuntimeService, 'getRuntimeId'> & Partial<VshuRuntimeService>
) {
  return new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: These RPC cases supply every runtime method their handlers and envelope access.
    runtime: runtime as VshuRuntimeService,
    methods: REPO_METHODS
  })
}
