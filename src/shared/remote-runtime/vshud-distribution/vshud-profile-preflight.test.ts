import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseVshudProfilePreflight,
  type VshudPreflightRuntimeIdentity
} from './vshud-profile-preflight'

const response = {
  type: 'vshu_profile_state_ready',
  nonce: randomUUID(),
  runtime: 'bun',
  runtimeVersion: '1.4.2',
  artifactVersion: '0.1.0+123456789abc',
  sqliteVersion: '3.51.0',
  revision: 1
}

const bun: VshudPreflightRuntimeIdentity = { runtime: 'bun', runtimeVersion: '1.4.2' }

function parse(value: unknown, expected = bun) {
  return parseVshudProfilePreflight(
    JSON.stringify(value),
    response.nonce,
    expected,
    response.artifactVersion
  )
}

describe('candidate profile readiness', () => {
  it.each([
    { nonce: randomUUID() },
    { runtime: 'node' },
    { runtimeVersion: '1.4.0' },
    { artifactVersion: '0.1.0+000000000000' },
    { revision: 0 },
    { sqliteVersion: '' }
  ])('refuses stale or incomplete evidence: %j', (change) => {
    expect(() => parse({ ...response, ...change })).toThrow()
  })

  it('admits a Node candidate only when the caller launched Node', () => {
    const node = { ...response, runtime: 'node', runtimeVersion: '24.21.0' }
    const expected: VshudPreflightRuntimeIdentity = { runtime: 'node', runtimeVersion: '24.21.0' }
    expect(parse(node, expected)).toEqual(node)
    expect(() => parse(node)).toThrow('expected candidate runtime')
    expect(() => parse(response, expected)).toThrow('expected candidate runtime')
  })

  it('does not choose a successful line out of contradictory output', () => {
    expect(() =>
      parseVshudProfilePreflight(
        `${JSON.stringify(response)}\n${JSON.stringify({ ...response, revision: 0 })}`,
        response.nonce,
        bun
      )
    ).toThrow()
  })
})
