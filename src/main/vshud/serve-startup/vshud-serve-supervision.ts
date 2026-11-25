// `vshu serve --supervise` runs vshud under a service manager, which restarts it routinely.
import process from 'node:process'
import { VSHU_SERVE_SUPERVISED_ENV } from '../../../shared/remote-runtime/serve-supervisor/serve-supervised-terminal-durability'

/** A supervised service must not hand out terminals that its next restart would kill. */
export class VshudTerminalsNotDurableError extends Error {
  constructor(readonly daemonFailure: string) {
    super(
      `The terminal daemon did not start (${daemonFailure}). This server runs under a service ` +
        'manager, so it will not start with terminals that a restart would lose; the supervisor ' +
        'retries with backoff.'
    )
    this.name = 'VshudTerminalsNotDurableError'
  }
}

/** Read once and drop it, so nothing vshud starts inherits it. */
export function takeVshudServeSupervision(env: NodeJS.ProcessEnv = process.env): boolean {
  const supervised = env[VSHU_SERVE_SUPERVISED_ENV] === '1'
  delete env[VSHU_SERVE_SUPERVISED_ENV]
  return supervised
}
