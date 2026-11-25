import { describe, expect, it } from 'vitest'
import '../../construction/test-context/runtime-test-module-registration.spec'
import { VshuRuntimeService } from '../../vshu-runtime'
import { store } from '../../construction/test-context/vshu-runtime-test-fixtures.spec'
import '../../hosts/platform-probe/runtime-machine-name'

describe('VshuRuntimeService', () => {
  it('fails terminal listing closed when fresh PTY liveness is required and unavailable', async () => {
    const runtime = new VshuRuntimeService(store)
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null,
      listProcesses: async () => {
        throw new Error('provider unavailable')
      }
    })

    await expect(
      runtime.listTerminals('id:repo-1::/tmp/worktree-a', undefined, {
        requireFreshPtyLiveness: true
      })
    ).rejects.toThrow('terminal_liveness_unavailable')
  })
})
