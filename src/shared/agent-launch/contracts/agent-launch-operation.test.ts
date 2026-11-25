import { describe, expect, it } from 'vitest'
import { computeAgentLaunchFingerprint } from './agent-launch-operation'

describe('transient cwd observation is not launch intent', () => {
  const create = {
    repo: 'id:00000000-0000-4000-8000-000000000099',
    name: 'child',
    displayName: 'child',
    displayNameKind: 'user',
    runHooks: false,
    activate: false,
    cwdParentWorktree:
      'id:00000000-0000-4000-8000-000000000001::/Users/brennanbenson/vshu/workspaces/vshu/replay-parent::workspace:90ac0c9c-ef88-4f6a-a818-904b4b2c9ada',
    noParent: false,
    callerTerminalHandle: 'term_R',
    cliProvenanceRequest: { callerTerminalHandle: 'term_R' }
  }
  it('ignores transient cwd ambiguity without changing the persisted digest', () => {
    const input = { agent: 'codex', target: { kind: 'create-worktree' as const, create } }
    expect(computeAgentLaunchFingerprint(input)).toBe(
      '8274e42b1523d53f5fcfff9d00d2e3fb8a6557b0c6a54c89d4d661a11c6a87a2'
    )
    expect(
      computeAgentLaunchFingerprint({
        ...input,
        target: { ...input.target, create: { ...create, cwdParentAmbiguous: true } }
      })
    ).toBe('8274e42b1523d53f5fcfff9d00d2e3fb8a6557b0c6a54c89d4d661a11c6a87a2')
  })
})
