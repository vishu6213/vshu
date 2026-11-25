import { createManagedCommandMatcher } from '../../../agent-hooks/installation/commands/managed-hook-command-matching'
import { readHooksJson } from '../../../agent-hooks/installation/configuration/hooks-json-read'
import { escapeTomlBasicString } from '../../configuration/toml/config-toml-syntax'
import {
  createCodexHookTrustEntry,
  getCodexManagedScriptFileName
} from '../../hooks/definitions/codex-hook-identity'
import { getInPlaceCodexHookHome } from '../../trust/hooks/codex-hook-vshu-approvals'
import { computeCodexTrustKey } from '../../trust/identity/codex-trust-identity'

/**
 * Chat strips pane env, so Vshu's status hooks only cost a spawn per event, and under Store
 * PowerShell every spawn fails (openai/codex#47810). Disable Vshu's entries, including older
 * forms the installer keeps, for this launch. One inline table because Codex splits `-c` keys
 * on every dot, including the one in hooks.json.
 */
export function codexVshuHooksOffArgs(codexHomePath: string): string[] {
  const home = getInPlaceCodexHookHome(codexHomePath)
  const isVshuCommand = createManagedCommandMatcher(getCodexManagedScriptFileName())
  const hooks = readHooksJson(home.hooksJsonPath)?.hooks ?? {}
  // hooks.json is user-editable; skip malformed groups and handlers as Codex does.
  const entries = Object.entries(hooks).flatMap(([eventName, groups]) =>
    (Array.isArray(groups) ? groups : []).flatMap((group, groupIndex) =>
      (Array.isArray(group?.hooks) ? group.hooks : []).flatMap((hook, handlerIndex) =>
        hook && isVshuCommand(hook.command)
          ? home.keySourcePaths.flatMap((sourcePath) => {
              const entry = createCodexHookTrustEntry(
                sourcePath,
                eventName,
                groupIndex,
                handlerIndex,
                group,
                hook
              )
              return entry
                ? [`"${escapeTomlBasicString(computeCodexTrustKey(entry))}"={enabled=false}`]
                : []
            })
          : []
      )
    )
  )
  return entries.length > 0 ? ['-c', `hooks.state={${entries.join(',')}}`] : []
}
