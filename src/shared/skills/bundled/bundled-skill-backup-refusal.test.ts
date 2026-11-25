import { describe, expect, it } from 'vitest'
import {
  bundledSkillOpBackupPaths,
  bundledSkillOpPublished,
  bundledSkillOpRefusalNotice,
  bundledSkillRefusalNotices
} from './bundled-skill-backup-refusal'
import type { BundledSkillOpOutcome } from './bundled-skill-plan'

const SKILLS = '/home/u/.agents/skills'
const op = (fields: Partial<BundledSkillOpOutcome>): BundledSkillOpOutcome => ({
  path: `${SKILLS}/vshu`,
  kind: 'update',
  status: 'failed',
  error: 'EXDEV',
  ...fields
})

describe('bundled skill backup refusal notices', () => {
  it('offers a moved-aside copy again unless the host marks this result its only notice', () => {
    const beside = bundledSkillOpRefusalNotice(
      'vshu',
      op({
        contentApplied: true,
        backupRefusal: { path: `${SKILLS}/.vshu.vshu-old-1`, source: 'moved-aside' }
      })
    )
    expect(beside).toEqual({
      skill: 'vshu',
      path: `${SKILLS}/.vshu.vshu-old-1`,
      source: 'moved-aside',
      contentApplied: true,
      offeredAgain: true
    })
    const formerRoot = bundledSkillOpRefusalNotice(
      'vshu',
      op({
        contentApplied: true,
        backupRefusal: {
          path: '/home/u/.gemini/skills/.vshu.vshu-old-2',
          source: 'moved-aside',
          onlyNotice: true
        }
      })
    )
    expect(formerRoot?.offeredAgain).toBe(false)
  })

  it('never infers a refusal from a generic EXDEV', () => {
    expect(bundledSkillOpRefusalNotice('vshu', op({}))).toBeNull()
    expect(
      bundledSkillRefusalNotices({
        scope: 'global',
        skills: [{ name: 'vshu', status: 'ran', ops: [op({})] }]
      })
    ).toEqual([])
  })

  it('lists every backup, falling back to an older host’s single path', () => {
    expect(
      bundledSkillOpBackupPaths(op({ backupPath: '/b/1', backupPaths: ['/b/1', '/b/2'] }))
    ).toEqual(['/b/1', '/b/2'])
    expect(bundledSkillOpBackupPaths(op({ backupPath: '/b/1' }))).toEqual(['/b/1'])
    expect(bundledSkillOpBackupPaths(op({}))).toEqual([])
  })

  // Notices say "Vshu updated the skill" only from this; a refused or rechecked op published nothing.
  it('counts an op as published only when it put new content at its path', () => {
    expect(
      bundledSkillOpPublished(
        op({ kind: 'replace', backupRefusal: { path: 'p', source: 'in-place' } })
      )
    ).toBe(false)
    expect(bundledSkillOpPublished(op({ kind: 'keep', status: 'done', backupPath: '/b/1' }))).toBe(
      false
    )
    expect(bundledSkillOpPublished(op({ kind: 'keep', currentConfirmed: true }))).toBe(false)
    expect(bundledSkillOpPublished(op({ kind: 'update', status: 'done' }))).toBe(true)
    expect(bundledSkillOpPublished(op({ kind: 'write', contentApplied: true }))).toBe(true)
  })
})
