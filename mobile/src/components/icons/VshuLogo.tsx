import { Image } from 'react-native'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { VSHU_LOGO_ASSETS } from './vshu-logo-assets'

type Props = {
  size?: number
  color?: string
}

// Vshu logo (chrome V, orbit ring, sparkle); scripts/apply-vshu-branding.mjs derives both assets.
// Light schemes get the inverted render; an explicit `color` tints it into a one-colour silhouette.
export function VshuLogo({ size = 24, color }: Props) {
  const scheme = useMobileColorScheme()
  return (
    <Image
      source={scheme === 'light' ? VSHU_LOGO_ASSETS.onLight : VSHU_LOGO_ASSETS.onDark}
      style={{ width: size, height: size, tintColor: color }}
      resizeMode="contain"
    />
  )
}
