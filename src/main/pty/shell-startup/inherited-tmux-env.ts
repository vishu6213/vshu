export const VSHU_INHERITED_TMUX_ENV = 'VSHU_INHERITED_TMUX'

/** Names the tmux pane Vshu itself runs in, so hooks don't take it for a tmux started in the pane. */
export function stampInheritedTmuxEnv(
  env: Record<string, string | undefined>,
  explicitEnv: Record<string, string> | undefined
): void {
  delete env[VSHU_INHERITED_TMUX_ENV]
  const { TMUX: tmux, TMUX_PANE: pane } = env
  if (!tmux || !pane || explicitEnv?.TMUX !== undefined || explicitEnv?.TMUX_PANE !== undefined) {
    return
  }
  // Same "<pane> <socket>" shape the hook scripts report: TMUX minus its ",pid,session" tail.
  env[VSHU_INHERITED_TMUX_ENV] = `${pane} ${tmux.replace(/,[^,]*,[^,]*$/, '')}`
}
