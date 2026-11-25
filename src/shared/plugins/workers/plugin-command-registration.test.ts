import { describe, expect, it } from 'vitest'
import { mountWorker } from '../declarative/testing/testing-worker'
import { createMockHost } from '../declarative/testing/testing-host'
import type { PluginWorkerVshuApi } from './plugin-worker-vshu-api'

describe('commands.register', () => {
  it('lets only the current registration dispose a re-registered command', async () => {
    const handler = () => 'pong'
    let stale: { dispose(): void } | undefined
    let current: { dispose(): void } | undefined
    const mounted = await mountWorker(
      {
        default(vshu: PluginWorkerVshuApi) {
          stale = vshu.commands.register('ping', handler)
          current = vshu.commands.register('ping', handler)
        }
      },
      { host: createMockHost({}, []), events: [], commands: ['ping'], hooks: [] }
    )

    stale?.dispose()
    expect(await mounted.command('ping')).toBe('pong')
    current?.dispose()
    await expect(mounted.command('ping')).rejects.toThrow(
      'command: the worker registered no "ping"'
    )
  })
})
