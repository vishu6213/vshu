// A single event handler keeps cwd reporting independent of the user's prompt function.
export const FISH_CWD_REPORT_BLOCK = `function __vshu_cwd_report --on-event fish_prompt
  if not set -q __vshu_cwd_reported; or test "$PWD" != "$__vshu_cwd_reported"
    set -g __vshu_cwd_encoded (string escape --style=url -- "$PWD")
    set -g __vshu_cwd_reported "$PWD"
  end
  builtin printf '\\033]7;file://localhost%s\\007' "$__vshu_cwd_encoded"
end`
