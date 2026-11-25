import { describe, expect, it } from 'vitest'
import type { VshuProfileCloudSummary } from '../../../../shared/vshu-profiles/vshu-profiles'
import { appRailAccount } from './AppRailAccountMenu'

const CLOUD: VshuProfileCloudSummary = {
  cloudProfileId: 'c1',
  userId: 'u1',
  email: 'alex@example.com',
  displayName: 'Alex Chen',
  linkedAt: 1
}

describe('appRailAccount', () => {
  it('prefers the display name, then the email, then the fallback', () => {
    expect(appRailAccount(CLOUD, 'Vshu account')).toEqual({
      name: 'Alex Chen',
      email: 'alex@example.com',
      initial: 'A'
    })
    expect(appRailAccount({ ...CLOUD, displayName: '  ' }, 'Vshu account').name).toBe(
      'alex@example.com'
    )
    expect(appRailAccount(undefined, 'Vshu account')).toEqual({
      name: 'Vshu account',
      email: undefined,
      initial: 'O'
    })
  })
})
