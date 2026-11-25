// Host-advertised: vshuAccount.* lets a client sign this host's Vshu account in and out.
export const VSHU_ACCOUNT_SERVER_SIGN_IN_RUNTIME_CAPABILITY =
  'vshu-account.server-sign-in.v1' as const

// Host-advertised: `vshuAccount.signIn.start` takes `approveInBrowser`, so nothing is pasted back.
export const VSHU_ACCOUNT_APPROVE_IN_BROWSER_RUNTIME_CAPABILITY =
  'vshu-account.server-sign-in.approve-in-browser.v1' as const
