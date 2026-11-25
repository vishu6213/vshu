import { LEGACY_BRANDS } from '../../branding/legacy-brand-names'

// Why the neighbours: a brand word inside a URL, path, package or key (`stablyai/x-plugins`,
// `x.dev`, `stablyai.x-theme`, `@x/sdk`) is an identifier, not the product's name.
const LEGACY_BRAND_WORD = new RegExp(
  `(?<![\\p{L}\\p{N}_./@-])(?:${LEGACY_BRANDS.join('|')})(?![\\p{L}\\p{N}_/@]|\\.[\\p{L}\\p{N}])`,
  'giu'
)

function vshuInCaseOf(word: string): string {
  if (word === word.toUpperCase()) {
    return 'VSHU'
  }
  return word[0] === word[0]!.toUpperCase() ? 'Vshu' : 'vshu'
}

/**
 * Plugin text as Vshu shows it. Official and community catalogs are upstream's, so their names,
 * descriptions and titles name the upstream product; show this product's name instead.
 * Display only: keys, ids, manifests, hashes, validation and the publisher never pass through it.
 */
export function pluginDisplayBranding(text: string): string {
  return text.replace(LEGACY_BRAND_WORD, (word: string, offset: number) =>
    // Why: lowercase before a hyphen is a slug (`x-plugins`); a capital is prose (`X-native`).
    text[offset + word.length] === '-' && word === word.toLowerCase() ? word : vshuInCaseOf(word)
  )
}
