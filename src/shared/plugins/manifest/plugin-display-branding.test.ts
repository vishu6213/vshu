import { describe, expect, it } from 'vitest'
import { NEWER_BRAND_NAME, ORIGINAL_BRAND_NAME } from '../../branding/legacy-brand-names'
import { pluginDisplayBranding } from './plugin-display-branding'

// Legacy words come from fragments: the rebrand codemod rewrites literal ones.
const lower = ORIGINAL_BRAND_NAME
const capital = lower[0]!.toUpperCase() + lower.slice(1)
const newerCapital = NEWER_BRAND_NAME[0]!.toUpperCase() + NEWER_BRAND_NAME.slice(1)

describe('pluginDisplayBranding', () => {
  it('names this product in plugin names, descriptions and catalog titles, keeping case', () => {
    expect(pluginDisplayBranding(`GitHub Themes for ${capital}`)).toBe('GitHub Themes for Vshu')
    expect(pluginDisplayBranding(`${capital} Official Plugins`)).toBe('Vshu Official Plugins')
    expect(pluginDisplayBranding(`Open spreadsheets in ${capital}'s editor.`)).toBe(
      "Open spreadsheets in Vshu's editor."
    )
    expect(pluginDisplayBranding(`Packaged for ${capital}.`)).toBe('Packaged for Vshu.')
    expect(pluginDisplayBranding(`${lower.toUpperCase()} MODE`)).toBe('VSHU MODE')
    expect(pluginDisplayBranding(`works in ${lower} too`)).toBe('works in vshu too')
    expect(pluginDisplayBranding(`${newerCapital} Night`)).toBe('Vshu Night')
    expect(pluginDisplayBranding(`${capital}-native look`)).toBe('Vshu-native look')
  })

  it('leaves words that merely contain the brand and identifiers alone', () => {
    for (const text of [
      `${capital}s and whales`,
      `https://example.com/acme/${lower}-plugins`,
      `stablyai.${lower}-midnight-theme`,
      `see ${lower}.dev`,
      `@${lower}/sdk`,
      `the ${lower}-plugins repository`
    ]) {
      expect(pluginDisplayBranding(text)).toBe(text)
    }
  })
})
