import { vi } from 'vitest'

// Run the pane-close no-widening contract under main-owned layout.
vi.mock('../../../../shared/workspace-layout/layout-owner-switch', () => ({
  VSHU_LAYOUT_OWNER_IS_MAIN: true
}))

await import('./vshu-runtime-terminal-close-no-widening.test')
