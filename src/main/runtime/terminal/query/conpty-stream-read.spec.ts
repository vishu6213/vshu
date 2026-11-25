import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../construction/test-context/runtime-test-module-registration.spec'
import { VshuRuntimeService } from '../../vshu-runtime'
import { join } from 'node:path'
import {
  store,
  syncSinglePty
} from '../../construction/test-context/vshu-runtime-test-fixtures.spec'
import {
  clearNativeWindowsConptyPty,
  markNativeWindowsConptyPty
} from '../output/terminal-model-query-authority'

// Captured pwsh 7.6/ConPTY: grey PSReadLine predictions from history are overwritten by absolute cursor moves.
const PSREADLINE_PREDICTION_TRANSCRIPT = readFileSync(
  join(__dirname, '..', '..', '__fixtures__', 'pwsh-7-6-psreadline-history-prediction-conpty.txt'),
  'utf8'
)
const PROMPT = 'PS C:\\Users\\user\\vshu\\workspaces\\vshu\\run-ownership-validation>'

async function startConptyRuntime(ptyId: string): Promise<InstanceType<typeof VshuRuntimeService>> {
  const runtime = new VshuRuntimeService(store)
  runtime.setPtyController({
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null,
    getSize: () => ({ cols: 120, rows: 30 })
  })
  await syncSinglePty(runtime, ptyId)
  return runtime
}

describe('VshuRuntimeService ConPTY stream reads', () => {
  it('does not read PSReadLine history prediction ghost text as this terminal’s input', async () => {
    const ptyId = 'pty-conpty-prediction'
    markNativeWindowsConptyPty(ptyId)
    try {
      const runtime = await startConptyRuntime(ptyId)
      const [terminal] = (await runtime.listTerminals()).terminals
      runtime.onPtyData(ptyId, PSREADLINE_PREDICTION_TRANSCRIPT, 100)

      const read = await runtime.readTerminal(terminal.handle)

      expect(read.tail.join('\n')).not.toContain('FOREIGN_LANE_COMMAND')
      expect(read.tail.join('\n')).not.toContain('other.py')
      expect(read.tail).toEqual([`${PROMPT} Write-Output OWN_MARKER`, 'OWN_MARKER', PROMPT])
    } finally {
      clearNativeWindowsConptyPty(ptyId)
    }
  })
})
