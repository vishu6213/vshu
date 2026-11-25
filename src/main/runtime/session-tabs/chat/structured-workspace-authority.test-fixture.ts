import type { VshuRuntimeService } from '../../vshu-runtime'

export const availableRevealWorkspace: VshuRuntimeService['prepareStructuredAgentSessionRevealWorkspace'] =
  async () => ({
    current: () => true,
    check: () => {},
    release: Object.assign(() => {}, { isCurrent: () => true })
  })
