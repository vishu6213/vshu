import { afterEach, describe, expect, it, vi } from 'vitest'
import { Document, stringify } from 'yaml'
import {
  MAX_VSHU_YAML_BYTES,
  MAX_VSHU_YAML_COLLECTION_ENTRIES,
  MAX_VSHU_YAML_FIELD_BYTES,
  MAX_VSHU_YAML_FIELD_CODE_UNITS
} from './vshu-yaml-file-limit'
import { parseVshuYaml } from './vshu-yaml'

afterEach(() => vi.restoreAllMocks())

describe('vshu.yaml parse bounds', () => {
  it('admits the exact UTF-8 input boundary and rejects +1 before conversion', () => {
    const toJS = vi.spyOn(Document.prototype, 'toJS')
    const prefix = 'scripts:\n  setup: pnpm install\n#'
    const exact = prefix + ' '.repeat(MAX_VSHU_YAML_BYTES - prefix.length)
    expect(parseVshuYaml(exact)).toMatchObject({ scripts: { setup: 'pnpm install' } })
    expect(toJS).toHaveBeenCalledOnce()
    toJS.mockClear()
    expect(parseVshuYaml(`${exact} `)).toBeNull()
    expect(toJS).not.toHaveBeenCalled()
  })

  it('rejects a multibyte input over the byte cap before conversion', () => {
    const toJS = vi.spyOn(Document.prototype, 'toJS')
    expect(parseVshuYaml('é'.repeat(MAX_VSHU_YAML_BYTES / 2 + 1))).toBeNull()
    expect(toJS).not.toHaveBeenCalled()
  })

  it('preserves exact-size fields and drops a field at +1 code unit', () => {
    const exact = 'x'.repeat(MAX_VSHU_YAML_FIELD_CODE_UNITS)
    expect(parseVshuYaml(stringify({ scripts: { setup: exact } }))).toMatchObject({
      scripts: { setup: exact }
    })
    expect(parseVshuYaml(stringify({ scripts: { setup: `${exact}x` } }))).toBeNull()
    const exactUtf8 = 'é'.repeat(MAX_VSHU_YAML_FIELD_BYTES / 2)
    expect(parseVshuYaml(stringify({ scripts: { setup: exactUtf8 } }))).toMatchObject({
      scripts: { setup: exactUtf8 }
    })
    expect(parseVshuYaml(stringify({ scripts: { setup: `${exactUtf8}é` } }))).toBeNull()
  })

  it('admits the exact collection boundary and rejects +1 entries', () => {
    const tabs = Array.from({ length: MAX_VSHU_YAML_COLLECTION_ENTRIES }, (_, index) => ({
      title: `tab-${index}`
    }))
    expect(parseVshuYaml(stringify({ defaultTabs: tabs }))?.defaultTabs).toHaveLength(
      MAX_VSHU_YAML_COLLECTION_ENTRIES
    )
    expect(parseVshuYaml(stringify({ defaultTabs: [...tabs, { title: 'overflow' }] }))).toBeNull()
  })
})
