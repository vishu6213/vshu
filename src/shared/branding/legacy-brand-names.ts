// Assembled from fragments because scripts/vshu-rebrand.mjs rewrites every literal brand word.
const NEWER_BRAND = ['hel', 'ix'].join('')
const ORIGINAL_BRAND = ['or', 'ca'].join('')

/** Brands earlier builds wrote to disk, newest first: a newer copy wins when both exist. */
export const LEGACY_BRANDS: readonly string[] = [NEWER_BRAND, ORIGINAL_BRAND]

/**
 * Each legacy brand by name, for hash domains and key-derivation labels that earlier builds
 * spelled with it: their outputs name persisted data, so the label must never change.
 */
export const ORIGINAL_BRAND_NAME = ORIGINAL_BRAND
export const NEWER_BRAND_NAME = NEWER_BRAND

const CURRENT_BRAND = 'vshu'

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// Same case rules as the codemod: lowercase only at a word start, Capitalized anywhere, UPPER not after a capital.
const LOWER = new RegExp(`(?<![A-Za-z])(?:${NEWER_BRAND}|${ORIGINAL_BRAND})`, 'g')
const CAPITAL = new RegExp(`(?:${capitalize(NEWER_BRAND)}|${capitalize(ORIGINAL_BRAND)})`, 'g')
const UPPER = new RegExp(
  `(?<![A-Z])(?:${NEWER_BRAND.toUpperCase()}|${ORIGINAL_BRAND.toUpperCase()})`,
  'g'
)

/** The name the codemod gives a legacy-branded path segment; unchanged when it carries no legacy brand. */
export function rebrandLegacyName(name: string): string {
  return name
    .replace(LOWER, CURRENT_BRAND)
    .replace(CAPITAL, capitalize(CURRENT_BRAND))
    .replace(UPPER, CURRENT_BRAND.toUpperCase())
}

/** Index of the newest legacy brand `name` carries (0 = newest), or -1 when it carries none. */
export function legacyBrandRank(name: string): number {
  const lower = name.toLowerCase()
  return LEGACY_BRANDS.findIndex((brand) => lower.includes(brand))
}

function spellWith(text: string, lower: string, capital: string, upper: string): string {
  return text
    .replaceAll(CURRENT_BRAND, lower)
    .replaceAll(capitalize(CURRENT_BRAND), capitalize(capital))
    .replaceAll(CURRENT_BRAND.toUpperCase(), upper.toUpperCase())
}

/** How each earlier brand spelled a vshu-branded name, newest brand first; excludes `name` itself. */
export function legacySpellings(name: string): string[] {
  const spellings = LEGACY_BRANDS.map((brand) => spellWith(name, brand, brand, brand))
  return [...new Set(spellings)].filter((spelling) => spelling !== name)
}

/** `marker` plus every mixed-brand spelling earlier builds may have written, for recognizing owned text. */
export function brandMarkerVariants(marker: string): string[] {
  const brands = [CURRENT_BRAND, ...LEGACY_BRANDS]
  const variants = new Set<string>()
  for (const lower of brands) {
    for (const capital of brands) {
      for (const upper of brands) {
        variants.add(spellWith(marker, lower, capital, upper))
      }
    }
  }
  return [...variants]
}
