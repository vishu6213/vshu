// Clear the launching terminal’s inherited Vshu identity so test branches depend on fixture env, not which agent launched runner.
// Clear the launching terminal's identity too: macOS /etc/zshrc and /etc/bashrc source /etc/{zsh,bash}rc_$TERM_PROGRAM.
for (const name of [
  'VSHU_AGENT_SESSION_ID',
  'VSHU_STRUCTURED_SESSION',
  'VSHU_WORKTREE_ID',
  'VSHU_WORKSPACE_ID',
  'VSHU_RUNTIME_SOURCE_ID',
  'VSHU_RUNTIME_SOURCE_INCARNATION',
  'VSHU_RUNTIME_SOURCE_PROFILE_PATH',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID'
]) {
  delete process.env[name]
}
