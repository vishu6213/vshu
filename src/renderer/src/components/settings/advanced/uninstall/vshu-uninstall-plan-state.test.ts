import { describe, expect, it, vi } from 'vitest'
import type {
  VshuUninstallPlan,
  VshuUninstallRunStepArgs
} from '../../../../../../shared/uninstall/vshu-uninstall-types'
import { runVshuUninstallSteps } from './vshu-uninstall-plan-state'

const plan: VshuUninstallPlan = {
  installKind: 'mac-app',
  agents: [
    {
      agent: 'claude',
      paths: [{ path: '~/.claude/settings.json', vshuData: null }],
      state: 'present',
      detail: null
    }
  ],
  cliCommand: null,
  backgroundService: { location: 'launchd', state: 'present', detail: null },
  hookScripts: { location: '~/.vshu/agent-hooks', state: 'present', detail: null },
  hosts: [],
  terminalDaemon: null,
  otherVshuBuildName: null,
  appPath: null,
  removeAppCommand: null
}

describe('runVshuUninstallSteps', () => {
  it('runs only the steps the plan has, and a thrown step marks just its own rows', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const runStep = vi.fn(async ({ step }: VshuUninstallRunStepArgs) => {
      if (step === 'background-service') {
        throw new Error('launchctl failed')
      }
      return {
        ...plan,
        agents: [{ ...plan.agents[0], state: 'removed' as const }],
        hookScripts: null
      }
    })

    const result = await runVshuUninstallSteps(plan, runStep, 'failed', () => {})

    expect(runStep.mock.calls.map(([args]) => args.step)).toEqual([
      'agent-hooks',
      'background-service',
      'hook-scripts'
    ])
    expect(result.agents[0].state).toBe('removed')
    expect(result.backgroundService).toEqual({
      location: 'launchd',
      state: 'error',
      detail: 'failed'
    })
    expect(result.hookScripts?.state).toBe('removed')
  })
})
