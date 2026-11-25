import { describe, expect, it } from 'vitest'
import { formatConnectorLinkDeepLink, parseConnectorLinkDeepLink } from './connector-link-deep-link'

describe('parseConnectorLinkDeepLink', () => {
  const token = `${'aB3_-'.repeat(8)}xyz`

  it("reads the result from a connect trip's Open Vshu, for Linear and GitHub", () => {
    expect(parseConnectorLinkDeepLink(`vshu://linear/link?t=${token}`)).toEqual({
      source: 'linear',
      token
    })
    expect(parseConnectorLinkDeepLink(`vshu://linear/link/?t=${token}`)).toEqual({
      source: 'linear',
      token
    })
    expect(parseConnectorLinkDeepLink(`vshu://github/link?t=${token}`)).toEqual({
      source: 'github',
      token
    })
    for (const source of ['linear', 'github'] as const) {
      expect(parseConnectorLinkDeepLink(formatConnectorLinkDeepLink({ source, token }))).toEqual({
        source,
        token
      })
    }
  })

  it.each([
    'vshu://linear/link',
    'vshu://linear/link?t=short',
    'vshu://github/link?t=a%2Fbcdefghijklmnopqrstu',
    `vshu://linear/install?t=${'a'.repeat(43)}`,
    `vshu://bot/link?t=${'a'.repeat(43)}`,
    `vshu://slack/link?t=${'a'.repeat(43)}`,
    `vshu://constructor/link?t=${'a'.repeat(43)}`,
    `https://linear.app/link?t=${'a'.repeat(43)}`,
    `https://github.com/link?t=${'a'.repeat(43)}`
  ])('rejects %s', (value) => {
    expect(parseConnectorLinkDeepLink(value)).toBeNull()
  })
})
