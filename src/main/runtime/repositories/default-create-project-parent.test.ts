import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDefaultCreateProjectParent } from './default-create-project-parent'

const fallback = join(homedir(), 'vshu', 'projects')

describe('getDefaultCreateProjectParent', () => {
  it("suggests the host's own absolute Workspace Directory", () => {
    const custom = join(homedir(), 'Code', 'vshu')
    expect(getDefaultCreateProjectParent({ workspaceDir: custom })).toBe(custom)
  })

  it('keeps <home>/vshu/projects for a repo-relative Workspace Directory', () => {
    expect(getDefaultCreateProjectParent({ workspaceDir: '.vshu/worktrees' })).toBe(fallback)
  })
})
