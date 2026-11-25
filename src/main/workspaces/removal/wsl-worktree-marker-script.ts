import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { RemoveLocalWorktreeMarkerOptions } from './local-worktree-filesystem'

const PARSE_VSHU_GITDIR_LINE = [
  'vshu_line=$(LC_ALL=C head -n 1 ./.git)',
  'vshu_line="${vshu_line%"${vshu_line##*[![:space:]]}"}"',
  'case "$vshu_line" in [Gg][Ii][Tt][Dd][Ii][Rr]:*) vshu_gitdir=${vshu_line#*:}; vshu_gitdir="${vshu_gitdir#"${vshu_gitdir%%[![:space:]]*}"}" ;; *) vshu_gitdir="" ;; esac'
].join(' && ')

const VERIFY_MARKER_BATCH_AND_RM = quotePosixShell(
  [
    'vshu_t=$1; vshu_rm=$2; vshu_mid=$3; vshu_sgd=$4; shift 4;',
    '[ "$(LC_ALL=C stat -c \'%F#%d:%i\' -- "$vshu_t" 2>/dev/null)" = "$vshu_rm" ] || exit 4;',
    '[ "$(LC_ALL=C stat -c \'%F#%d:%i\' -- . 2>/dev/null)" = "$vshu_rm" ] || exit 4;',
    "if vshu_m=$(LC_ALL=C stat -c '%F#%d:%i' -- ./.git 2>&1); then",
    "case \"$vshu_m\" in 'regular file#'*|'regular empty file#'*) ;; *) exit 4 ;; esac;",
    '[ "${vshu_m#*#}" = "$vshu_mid" ] || exit 4;',
    'vshu_line=$(LC_ALL=C head -n 1 ./.git) || exit 4;',
    'vshu_line="${vshu_line%"${vshu_line##*[![:space:]]}"}";',
    'case "$vshu_line" in [Gg][Ii][Tt][Dd][Ii][Rr]:*) vshu_gd=${vshu_line#*:}; vshu_gd="${vshu_gd#"${vshu_gd%%[![:space:]]*}"}" ;; *) vshu_gd="" ;; esac;',
    '[ "$vshu_gd" = "$vshu_sgd" ] || exit 4;',
    'LC_ALL=C exec rm -rf -- "$@";',
    "else case \"$vshu_m\" in *': No such file or directory'|*': Not a directory') exit 0 ;; *) printf '%s\\n' \"$vshu_m\" >&2; exit 1 ;; esac; fi"
  ].join(' ')
)

const VERIFY_MARKERLESS_BATCH_AND_RM = quotePosixShell(
  [
    'vshu_t=$1; vshu_rm=$2; shift 2;',
    '[ "$(LC_ALL=C stat -c \'%F#%d:%i\' -- "$vshu_t" 2>/dev/null)" = "$vshu_rm" ] || exit 4;',
    '[ "$(LC_ALL=C stat -c \'%F#%d:%i\' -- . 2>/dev/null)" = "$vshu_rm" ] || exit 4;',
    "if LC_ALL=C stat -c '%F' -- ./.git >/dev/null 2>&1; then exit 4; fi;",
    'LC_ALL=C exec rm -rf -- "$@"'
  ].join(' ')
)

// Pin the sweep to a subshell cwd verified against vshu_root_meta, re-verify before each rm batch, and exit the subshell before rmdir (#16463).
export function buildWslMarkerLastScript(
  target: string,
  {
    expectedMarker,
    forbidAnyMarker = false,
    expectedRoot,
    requireMarker = false
  }: RemoveLocalWorktreeMarkerOptions
): string {
  const expectedClause = forbidAnyMarker
    ? ' || true'
    : expectedMarker !== undefined
      ? ` || [ "$vshu_gitdir#$vshu_marker_ino" != ${quotePosixShell(expectedMarker)} ]`
      : ''
  const expectedRootClause =
    expectedRoot !== undefined
      ? `if [ "\${vshu_root_meta#*#}" != ${quotePosixShell(expectedRoot)} ]; then exit 4; fi;`
      : ''
  const markerlessBranch = requireMarker
    ? "if LC_ALL=C stat -c '%F' -- ./.git >/dev/null 2>&1; then exit 4; fi;"
    : [
        "if LC_ALL=C stat -c '%F' -- ./.git >/dev/null 2>&1; then exit 4; fi &&",
        `vshu_find_status=0; LC_ALL=C find -P . -mindepth 1 -maxdepth 1 ! -name .git -exec sh -c ${VERIFY_MARKERLESS_BATCH_AND_RM} sh "$vshu_target" "$vshu_root_meta" {} + || vshu_find_status=$?;`,
        'vshu_cur_root=$(LC_ALL=C stat -c \'%F#%d:%i\' -- "$vshu_target") || exit $? &&',
        'case "$vshu_cur_root" in \'directory#\'*) ;; *) echo "Refusing to delete non-directory worktree path" >&2; exit 3 ;; esac &&',
        'if [ "$vshu_cur_root" != "$vshu_root_meta" ]; then exit 4; fi &&',
        "if vshu_after=$(LC_ALL=C stat -c '%F' -- ./.git 2>&1); then exit 4;",
        'else case "$vshu_after" in *\': No such file or directory\'|*\': Not a directory\') if [ "$vshu_find_status" -ne 0 ]; then exit "$vshu_find_status"; fi ;; *) printf \'%s\\n\' "$vshu_after" >&2; exit 1 ;; esac; fi;'
      ].join(' ')
  return [
    `vshu_target=${target};`,
    'vshu_root_meta=$(LC_ALL=C stat -c \'%F#%d:%i\' -- "$vshu_target") || exit $?;',
    'case "$vshu_root_meta" in \'directory#\'*) ;; *) echo "Refusing to delete non-directory worktree path" >&2; exit 3 ;; esac;',
    expectedRootClause,
    '( cd -P -- "$vshu_target" || exit $?;',
    "vshu_pwd_meta=$(LC_ALL=C stat -c '%F#%d:%i' -- .) || exit $?;",
    'if [ "$vshu_pwd_meta" != "$vshu_root_meta" ]; then exit 4; fi;',
    "if vshu_meta=$(LC_ALL=C stat -c '%F#%d:%i#%i' -- ./.git 2>&1); then vshu_has_git=1;",
    "else case \"$vshu_meta\" in *': No such file or directory'|*': Not a directory') vshu_has_git=0 ;; *) printf '%s\\n' \"$vshu_meta\" >&2; exit 1 ;; esac; fi;",
    'if [ "$vshu_has_git" = 1 ]; then',
    "case \"$vshu_meta\" in 'regular file#'*|'regular empty file#'*) ;; *) exit 4 ;; esac &&",
    'vshu_rest=${vshu_meta#*#} && vshu_marker_id=${vshu_rest%#*} && vshu_marker_ino=${vshu_rest#*#} &&',
    `${PARSE_VSHU_GITDIR_LINE} &&`,
    `if [ -z "$vshu_gitdir" ]${expectedClause}; then exit 4; fi &&`,
    'vshu_saved_gitdir=$vshu_gitdir &&',
    `vshu_find_status=0; if [ -n "$(LC_ALL=C find -P . -mindepth 1 -maxdepth 1 -name .git -print)" ]; then LC_ALL=C find -P . -mindepth 1 -maxdepth 1 ! -name .git -exec sh -c ${VERIFY_MARKER_BATCH_AND_RM} sh "$vshu_target" "$vshu_root_meta" "$vshu_marker_id" "$vshu_saved_gitdir" {} + || vshu_find_status=$?; else LC_ALL=C find -P . -mindepth 1 -maxdepth 1 \\( ! -iname .git -o ! -samefile ./.git \\) -exec sh -c ${VERIFY_MARKER_BATCH_AND_RM} sh "$vshu_target" "$vshu_root_meta" "$vshu_marker_id" "$vshu_saved_gitdir" {} + || vshu_find_status=$?; fi;`,
    'vshu_cur_root=$(LC_ALL=C stat -c \'%F#%d:%i\' -- "$vshu_target") || exit $? &&',
    'case "$vshu_cur_root" in \'directory#\'*) ;; *) echo "Refusing to delete non-directory worktree path" >&2; exit 3 ;; esac &&',
    'if [ "$vshu_cur_root" != "$vshu_root_meta" ]; then exit 4; fi &&',
    "if vshu_after=$(LC_ALL=C stat -c '%F#%d:%i' -- ./.git 2>&1); then",
    "case \"$vshu_after\" in 'regular file#'*|'regular empty file#'*) ;; *) exit 4 ;; esac &&",
    'if [ "${vshu_after#*#}" != "$vshu_marker_id" ]; then exit 4; fi &&',
    `${PARSE_VSHU_GITDIR_LINE} &&`,
    'if [ "$vshu_gitdir" != "$vshu_saved_gitdir" ]; then exit 4; fi &&',
    'if [ "$vshu_find_status" -ne 0 ]; then exit "$vshu_find_status"; fi &&',
    'LC_ALL=C rm -f -- ./.git;',
    'else case "$vshu_after" in *\': No such file or directory\'|*\': Not a directory\') if [ "$vshu_find_status" -ne 0 ]; then exit "$vshu_find_status"; fi ;; *) printf \'%s\\n\' "$vshu_after" >&2; exit 1 ;; esac; fi;',
    'else',
    markerlessBranch,
    'fi ) || exit $?;',
    'vshu_cur_root=$(LC_ALL=C stat -c \'%F#%d:%i\' -- "$vshu_target") || exit $?;',
    'case "$vshu_cur_root" in \'directory#\'*) ;; *) echo "Refusing to delete non-directory worktree path" >&2; exit 3 ;; esac;',
    'if [ "$vshu_cur_root" != "$vshu_root_meta" ]; then exit 4; fi;',
    'if ! LC_ALL=C rmdir -- "$vshu_target"; then',
    'if LC_ALL=C stat -c \'%F\' -- "$vshu_target/.git" >/dev/null 2>&1; then exit 4; fi;',
    `if [ -n "$(LC_ALL=C ls -A -- "$vshu_target" 2>/dev/null)" ]; then exit ${requireMarker ? '4' : '5'}; fi;`,
    'exit 1;',
    'fi'
  ]
    .filter(Boolean)
    .join(' ')
}
