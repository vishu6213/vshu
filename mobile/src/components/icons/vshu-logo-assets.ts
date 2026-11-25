import type { ImageSourcePropType } from 'react-native'

// Keep literal require paths so Metro bundles both renders.
export const VSHU_LOGO_ASSETS: { onDark: ImageSourcePropType; onLight: ImageSourcePropType } = {
  onDark: require('../../../assets/vshu-logo.png'),
  onLight: require('../../../assets/vshu-logo-on-light.png')
}
