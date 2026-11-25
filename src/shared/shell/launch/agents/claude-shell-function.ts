import {
  VSHU_IMAGE_PROTOCOL_ENV,
  VSHU_IMAGE_PROTOCOL_VALUE
} from '../../../terminal/images/terminal-image-protocol'

/** Re-read account selection on every launch in Vshu-routed panes with a real claude binary. Missing/empty pointer restores the user’s config; another pane override wins. Create account homes without a login silently and preserve Anthropic auth. Refuse nonabsolute pointers rather than run under the wrong account. */
export function getPosixClaudeShellFunction(): string {
  return `__vshu_claude_binary="$(unalias claude 2>/dev/null || :; command -v claude 2>/dev/null || :)"
# Why typeset -f: a user's own claude function wins; command -v prints its bare name, which -x tests against the cwd.
if ! typeset -f claude >/dev/null 2>&1 && [[ -n "\${__vshu_claude_binary:-}" && -x "\${__vshu_claude_binary}" ]] &&
   [[ -n "\${VSHU_CLAUDE_PROFILE_POINTER:-}" || "\${${VSHU_IMAGE_PROTOCOL_ENV}:-}" == '${VSHU_IMAGE_PROTOCOL_VALUE}' ]]; then
  function claude {
    local __vshu_claude_home __vshu_claude_pointer="\${VSHU_CLAUDE_PROFILE_POINTER:-}"
    if [[ "\${${VSHU_IMAGE_PROTOCOL_ENV}:-}" == '${VSHU_IMAGE_PROTOCOL_VALUE}' && -z "\${CLAUDE_CODE_FORCE_TERMINAL_IMAGES+x}" ]]; then
      local -x CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1
    fi
    if [ -z "$__vshu_claude_pointer" ]; then
      command claude "$@"; return
    fi
    # Why: a WSL pane's pointer is relative to the guest home, which the host cannot know at spawn.
    case "$__vshu_claude_pointer" in '~/'*) __vshu_claude_pointer="\${HOME:-}/\${__vshu_claude_pointer#??}" ;; esac
    __vshu_claude_home="$(cat "$__vshu_claude_pointer" 2>/dev/null || :)"
    if [ -n "\${CLAUDE_CONFIG_DIR:-}" ] && [ "$CLAUDE_CONFIG_DIR" != "\${VSHU_CLAUDE_INJECTED_CONFIG_DIR:-}" ] &&
      { [ -z "\${VSHU_CLAUDE_USER_CONFIG_DIR:-}" ] || [ "\${CLAUDE_CONFIG_DIR%/}" != "\${VSHU_CLAUDE_USER_CONFIG_DIR%/}" ]; }; then
      command claude "$@"; return
    fi
    # Why exec: bash can keep the subshell leading Claude's foreground group; zsh exec runs functions, hence unset -f.
    # Why: Vshu's value replaced the user's own at spawn, so System default restores theirs.
    if [ -z "$__vshu_claude_home" ] && [ -n "\${CLAUDE_CONFIG_DIR:-}" ] && [ -n "\${VSHU_CLAUDE_USER_CONFIG_DIR:-}" ]; then
      ( unset VSHU_CLAUDE_INJECTED_CONFIG_DIR; export CLAUDE_CONFIG_DIR="$VSHU_CLAUDE_USER_CONFIG_DIR"; unset -f claude; exec claude "$@" ); return
    fi
    if [ -z "$__vshu_claude_home" ]; then
      ( unset CLAUDE_CONFIG_DIR VSHU_CLAUDE_INJECTED_CONFIG_DIR; unset -f claude; exec claude "$@" ); return
    fi
    case "$__vshu_claude_home" in /*|[A-Za-z]:*) ;; *) return 1 ;; esac
    # Why -m 700: matches the folder Vshu's setup creates; a credentials folder stays private.
    [ -d "$__vshu_claude_home" ] || mkdir -p -m 700 -- "$__vshu_claude_home" 2>/dev/null
    ( export CLAUDE_CONFIG_DIR="$__vshu_claude_home" VSHU_CLAUDE_INJECTED_CONFIG_DIR="$__vshu_claude_home"; unset -f claude; exec claude "$@" )
  }
fi
unset __vshu_claude_binary
`
}

/** Leading newline separates the preceding codex fragment, which has no trailing newline. */
export function getFishClaudeShellFunction(): string {
  return `
set -l __vshu_claude_type (type -t claude 2>/dev/null)
if test "$__vshu_claude_type" = file; and begin; test -n "$VSHU_CLAUDE_PROFILE_POINTER"; or test "$${VSHU_IMAGE_PROTOCOL_ENV}" = '${VSHU_IMAGE_PROTOCOL_VALUE}'; end
  function claude
    test "$${VSHU_IMAGE_PROTOCOL_ENV}" = '${VSHU_IMAGE_PROTOCOL_VALUE}'; and not set -q CLAUDE_CODE_FORCE_TERMINAL_IMAGES; and set -lx CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1
    if test -z "$VSHU_CLAUDE_PROFILE_POINTER"
      command claude $argv
      return $status
    end
    # Why: a WSL pane's pointer is relative to the guest home, which the host cannot know at spawn.
    set -l pointer (string replace -r '^~/' "$HOME/" -- "$VSHU_CLAUDE_PROFILE_POINTER")
    set -l profile (cat "$pointer" 2>/dev/null)
    set -l own (string trim -r -c / -- "$VSHU_CLAUDE_USER_CONFIG_DIR")
    set -l current (string trim -r -c / -- "$CLAUDE_CONFIG_DIR")
    if test -n "$CLAUDE_CONFIG_DIR"; and test "$CLAUDE_CONFIG_DIR" != "$VSHU_CLAUDE_INJECTED_CONFIG_DIR"; and begin; test -z "$own"; or test "$current" != "$own"; end
      command claude $argv
      return $status
    end
    if test -z "$profile"; and test -n "$CLAUDE_CONFIG_DIR"; and test -n "$VSHU_CLAUDE_USER_CONFIG_DIR"
      env -u VSHU_CLAUDE_INJECTED_CONFIG_DIR CLAUDE_CONFIG_DIR="$VSHU_CLAUDE_USER_CONFIG_DIR" claude $argv
      return $status
    end
    if test -z "$profile"
      env -u CLAUDE_CONFIG_DIR -u VSHU_CLAUDE_INJECTED_CONFIG_DIR claude $argv
      return $status
    end
    if not string match -qr '^(/|[A-Za-z]:)' -- "$profile"
      return 1
    end
    test -d "$profile"; or mkdir -p -m 700 -- "$profile" 2>/dev/null
    env CLAUDE_CONFIG_DIR="$profile" VSHU_CLAUDE_INJECTED_CONFIG_DIR="$profile" claude $argv
  end
end
set -e __vshu_claude_type
`
}

export function getPowerShellClaudeShellFunction(): string {
  return `$vshuClaudeCommand = Get-Command claude -ErrorAction SilentlyContinue | Select-Object -First 1
if (($env:VSHU_CLAUDE_PROFILE_POINTER -or $env:${VSHU_IMAGE_PROTOCOL_ENV} -ceq '${VSHU_IMAGE_PROTOCOL_VALUE}') -and $vshuClaudeCommand -and
    $vshuClaudeCommand.CommandType -in @("Application", "ExternalScript")) {
function Global:claude {
    $names = @('CLAUDE_CONFIG_DIR', 'VSHU_CLAUDE_INJECTED_CONFIG_DIR', 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES')
    $saved = @{}
    foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
        if ($env:${VSHU_IMAGE_PROTOCOL_ENV} -ceq '${VSHU_IMAGE_PROTOCOL_VALUE}' -and -not (Test-Path Env:CLAUDE_CODE_FORCE_TERMINAL_IMAGES)) {
            $env:CLAUDE_CODE_FORCE_TERMINAL_IMAGES = '1'
        }
        $vshuClaudeHome = ''
        if ($env:VSHU_CLAUDE_PROFILE_POINTER -and (Test-Path -LiteralPath $env:VSHU_CLAUDE_PROFILE_POINTER -PathType Leaf)) {
            $vshuClaudeHome = [IO.File]::ReadAllText($env:VSHU_CLAUDE_PROFILE_POINTER).TrimEnd()
        }
        # Why the separator swap: Windows names one folder with either separator.
        $own = ("$env:VSHU_CLAUDE_USER_CONFIG_DIR" -replace '/', '\\').TrimEnd('\\')
        if (-not $env:VSHU_CLAUDE_PROFILE_POINTER -or (
            $env:CLAUDE_CONFIG_DIR -and $env:CLAUDE_CONFIG_DIR -ne $env:VSHU_CLAUDE_INJECTED_CONFIG_DIR -and
            (-not $own -or ("$env:CLAUDE_CONFIG_DIR" -replace '/', '\\').TrimEnd('\\') -ne $own))) {
            # A value set in this pane, other than the user's own, wins.
        } elseif (-not $vshuClaudeHome) {
            Remove-Item Env:VSHU_CLAUDE_INJECTED_CONFIG_DIR -ErrorAction SilentlyContinue
            if ($env:CLAUDE_CONFIG_DIR -and $env:VSHU_CLAUDE_USER_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR = $env:VSHU_CLAUDE_USER_CONFIG_DIR }
            else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
        } elseif (-not [IO.Path]::IsPathRooted($vshuClaudeHome)) {
            $global:LASTEXITCODE = 1
            return
        } else {
            if (-not [IO.Directory]::Exists($vshuClaudeHome)) { $null = New-Item -ItemType Directory -Path $vshuClaudeHome -Force -ErrorAction SilentlyContinue }
            $env:CLAUDE_CONFIG_DIR = $vshuClaudeHome
            $env:VSHU_CLAUDE_INJECTED_CONFIG_DIR = $vshuClaudeHome
        }
        $binary = Get-Command claude -CommandType Application,ExternalScript -ErrorAction Stop | Select-Object -First 1
        $claudeArgs = @(__VshuEscapeNativeArgs $binary.Source $args)
        if ($MyInvocation.ExpectingInput) { $input | & $binary.Source @claudeArgs } else { & $binary.Source @claudeArgs }
        $global:LASTEXITCODE = $LASTEXITCODE
    } catch { $global:LASTEXITCODE = 1; Write-Error $_ -ErrorAction Continue }
    finally {
        # Why Remove-Item: on .NET 9+ a $null value (passed as "") creates the variable empty instead of deleting it.
        foreach ($name in $names) {
            if ($null -eq $saved[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
            else { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
        }
    }
}
}
Remove-Variable vshuClaudeCommand -ErrorAction SilentlyContinue
`
}
