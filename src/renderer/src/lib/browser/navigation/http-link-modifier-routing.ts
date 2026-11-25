/** Shift traditionally forces system browser; the inversion setting instead chooses the other destination when system is already default. */
export function resolveModifierRouting(
  modifierHeld: boolean,
  openLinksInApp: boolean,
  modifierInverts: boolean
): { wantsVshu: boolean; wantsSystemBrowser: boolean } {
  if (!modifierHeld) {
    return { wantsVshu: false, wantsSystemBrowser: false }
  }
  if (!modifierInverts) {
    return { wantsVshu: false, wantsSystemBrowser: true }
  }
  return { wantsVshu: !openLinksInApp, wantsSystemBrowser: openLinksInApp }
}
