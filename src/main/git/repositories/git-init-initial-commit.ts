import { gitExecFileAsync } from '../command-runner/git-exec-file'

export async function initializeGitRepositoryWithInitialCommit(targetPath: string): Promise<void> {
  await gitExecFileAsync(['init'], { cwd: targetPath, hostGit: true })
  try {
    await gitExecFileAsync(['commit', '--allow-empty', '-m', 'Initial commit'], {
      cwd: targetPath,
      hostGit: true
    })
  } catch (commitErr) {
    const commitMsg = commitErr instanceof Error ? commitErr.message : String(commitErr)
    if (/Please tell me who you are|user\.name|user\.email/i.test(commitMsg)) {
      const fallbackName =
        process.env.GIT_AUTHOR_NAME || process.env.USERNAME || process.env.USER || 'Vshu User'
      const fallbackEmail =
        process.env.GIT_AUTHOR_EMAIL ||
        `${(process.env.USERNAME || process.env.USER || 'developer').toLowerCase().replace(/\s+/g, '.') || 'user'}@vshu.local`

      await gitExecFileAsync(['config', 'user.name', fallbackName], {
        cwd: targetPath,
        hostGit: true
      }).catch(() => {})
      await gitExecFileAsync(['config', 'user.email', fallbackEmail], {
        cwd: targetPath,
        hostGit: true
      }).catch(() => {})
      await gitExecFileAsync(['config', '--global', 'user.name', fallbackName], {
        cwd: targetPath,
        hostGit: true
      }).catch(() => {})
      await gitExecFileAsync(['config', '--global', 'user.email', fallbackEmail], {
        cwd: targetPath,
        hostGit: true
      }).catch(() => {})

      await gitExecFileAsync(
        [
          '-c',
          `user.name=${fallbackName}`,
          '-c',
          `user.email=${fallbackEmail}`,
          'commit',
          '--allow-empty',
          '-m',
          'Initial commit'
        ],
        {
          cwd: targetPath,
          hostGit: true
        }
      )
      return
    }
    throw commitErr
  }
}
