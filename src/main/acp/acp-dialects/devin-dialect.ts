import type { AcpDialect } from './acp-dialect'

// Its mode commands would switch modes behind the permission picker; sign-in belongs to Vshu's setup.
export const DEVIN_ACP_DIALECT: AcpDialect = {
  withheldCommands: ['ask', 'plan', 'code', 'smart', 'bypass', 'login', 'logout']
}
