import { homedir } from 'node:os'
import { join } from 'node:path'

// Parallel Vshu instances must share one user-wide script path.
export function getSharedManagedScriptPath(scriptFileName: string): string {
  return join(homedir(), '.vshu', 'agent-hooks', scriptFileName)
}
