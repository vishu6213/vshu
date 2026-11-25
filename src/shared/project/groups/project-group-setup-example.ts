import type { Repo } from '../../repository/repo-types'
import { quoteStartupArg } from '../../agent-launch/startup/tui-agent-startup-shell'

export function projectGroupSetupExample(
  repos: readonly Pick<Repo, 'id' | 'displayName'>[],
  platform: NodeJS.Platform
): string {
  const windows = platform === 'win32'
  const comment = windows ? 'REM' : '#'
  const shell = windows ? 'cmd' : 'posix'
  const command = windows ? 'vshu' : '"${VSHU_CLI_COMMAND:-vshu}"'
  const workspaceName = windows ? '"%VSHU_WORKSPACE_NAME%"' : '"$VSHU_WORKSPACE_NAME"'
  return [
    `${comment} Repo IDs are local to this machine; review them before sharing this script.`,
    ...repos.flatMap((repo) => [
      `${comment} ${repo.displayName.replace(windows ? /[^\p{L}\p{N} ._/-]/gu : /[\r\n]/g, ' ')}`,
      `${command} worktree create --repo ${quoteStartupArg(`id:${repo.id}`, shell)} --name ${workspaceName} --json`
    ])
  ].join('\n')
}
