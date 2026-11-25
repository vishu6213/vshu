import { describe, expect, it } from 'vitest'
import { resolveConnectorOrigin } from './connector-origin'

describe('resolveConnectorOrigin', () => {
  it('honors VSHU_CONNECTOR_URL, the legacy host included', () => {
    expect(resolveConnectorOrigin({ VSHU_CONNECTOR_URL: 'https://connector.vshu.dev' }, true)).toBe(
      'https://connector.vshu.dev'
    )
    expect(resolveConnectorOrigin({ VSHU_CONNECTOR_URL: 'http://127.0.0.1:8787' }, false)).toBe(
      'http://127.0.0.1:8787'
    )
  })

  it('falls back to the default for an unusable override', () => {
    expect(resolveConnectorOrigin({ VSHU_CONNECTOR_URL: 'http://127.0.0.1:8787' }, true)).toBe(
      'https://connector.vshu.dev'
    )
    expect(
      resolveConnectorOrigin({ VSHU_CONNECTOR_URL: 'https://connector.vshu.dev/x' }, true)
    ).toBe('https://connector.vshu.dev')
  })
})
