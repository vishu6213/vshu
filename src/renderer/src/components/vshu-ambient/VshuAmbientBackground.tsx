import { useEffect, useRef } from 'react'
import { startAmbientMotion } from './ambient-motion'
import '../../styles/vshu-theme/index.css'

/**
 * Vshu's live backdrop: soft drifting light behind the glass chrome. Purely decorative, never
 * interactive, and only displayed in the built-in dark theme (see styles/vshu-theme/ambient.css).
 */
export function VshuAmbientBackground(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) {
      return undefined
    }
    return startAmbientMotion(root)
  }, [])

  return (
    <div ref={ref} className="vshu-ambient" aria-hidden="true" data-vshu-ambient="">
      <div className="vshu-ambient__orb" data-orb="key" />
      <div className="vshu-ambient__orb" data-orb="fill" />
      <div className="vshu-ambient__orb" data-orb="rim" />
      <div className="vshu-ambient__sheen" />
      <div className="vshu-ambient__grain" />
    </div>
  )
}
