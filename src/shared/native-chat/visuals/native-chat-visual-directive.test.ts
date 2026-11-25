import { describe, expect, it } from 'vitest'
import {
  isPendingNativeChatVisualDirectiveTail,
  parseNativeChatVisualDirectiveLine,
  parseNativeChatWebhookDirectiveLine,
  withoutNativeChatVisualDirectiveLines,
  withoutPendingNativeChatVisualDirectiveTail,
  withLegacyNativeChatIdeasAsList
} from './native-chat-visual-directive'

describe('parseNativeChatVisualDirectiveLine', () => {
  it('ignores unknown attributes but refuses a repeated one', () => {
    expect(parseNativeChatVisualDirectiveLine('::vshu-visual{file="a.html" height="300"}')).toEqual(
      { file: 'a.html', title: null }
    )
    expect(
      parseNativeChatVisualDirectiveLine('::vshu-visual{file="a.html" file="b.html"}')
    ).toBeNull()
    expect(
      parseNativeChatVisualDirectiveLine('::vshu-visual{file="a.html" title="x" title="y"}')
    ).toBeNull()
  })

  it.each([
    ['missing file', '::vshu-visual{title="T"}'],
    ['unclosed', '::vshu-visual{file="a.html"'],
    ['text after the line', '::vshu-visual{file="a.html"} see above'],
    ['text before the marker', 'Chart: ::vshu-visual{file="a.html"}'],
    ['wrong case', '::Vshu-Visual{file="a.html"}'],
    ['single quotes', "::vshu-visual{file='a.html'}"],
    ['backslash', '::vshu-visual{file="a.html" title="a\\b"}'],
    ['control character', '::vshu-visual{file="a.html" title="a\u0007b"}'],
    ['attributes glued together', '::vshu-visual{file="a.html"title="T"}'],
    ['uppercase key', '::vshu-visual{FILE="a.html"}'],
    ['embedded newline', '::vshu-visual{file="a.html"\ntitle="T"}'],
    ['three colons', ':::vshu-visual{file="a.html"}']
  ])('refuses %s', (_name, line) => {
    expect(parseNativeChatVisualDirectiveLine(line)).toBeNull()
  })
})

describe('streaming tail', () => {
  it('drops only the pending final line', () => {
    expect(withoutPendingNativeChatVisualDirectiveTail('Intro\n::vshu-visual{file="a')).toBe(
      'Intro\n'
    )
    expect(withoutPendingNativeChatVisualDirectiveTail('::vshu-vis')).toBe('')
    expect(withoutPendingNativeChatVisualDirectiveTail('Intro\nMore text')).toBe('Intro\nMore text')
    // A finished line (followed by a newline) is no longer the tail.
    expect(withoutPendingNativeChatVisualDirectiveTail('::vshu-visual{file="a.html"}\n')).toBe(
      '::vshu-visual{file="a.html"}\n'
    )
  })
})

describe('withoutNativeChatVisualDirectiveLines', () => {
  const LINE = '::vshu-visual{file="usage.html" title="Usage"}'

  it('keeps the line inside fenced code and anything that is not a whole directive line', () => {
    const fenced = `\`\`\`\n${LINE}\n\`\`\`\nafter`
    expect(withoutNativeChatVisualDirectiveLines(fenced)).toBe(fenced)
    const tilde = `~~~~\n${LINE}\n~~~\nstill code\n~~~~`
    expect(withoutNativeChatVisualDirectiveLines(tilde)).toBe(tilde)
    expect(withoutNativeChatVisualDirectiveLines(`> ${LINE}`)).toBe(`> ${LINE}`)
    expect(withoutNativeChatVisualDirectiveLines(`See ${LINE}`)).toBe(`See ${LINE}`)
  })

  it('follows CommonMark fence rules: no info string on a closer, no backtick in an opener', () => {
    // ```js inside a block does not close it, so the visual line is still code.
    const notClosed = `\`\`\`\n\`\`\`js\n${LINE}\n\`\`\``
    expect(withoutNativeChatVisualDirectiveLines(notClosed)).toBe(notClosed)
    // Inline triple backticks open no fence, so a later visual line is still dropped.
    expect(withoutNativeChatVisualDirectiveLines(`Use \`\`\`a\`\`\` inline\n${LINE}`)).toBe(
      'Use ```a``` inline'
    )
  })
})

describe('parseNativeChatWebhookDirectiveLine', () => {
  const LINE = '::vshu-webhook{hook="wh_7Kx2pQ9mT4vB8nLc"}'

  it('reads the hook id from a whole line', () => {
    expect(parseNativeChatWebhookDirectiveLine(LINE)).toEqual({ hookId: 'wh_7Kx2pQ9mT4vB8nLc' })
    expect(parseNativeChatWebhookDirectiveLine(`  ${LINE}  \r\n`)).toEqual({
      hookId: 'wh_7Kx2pQ9mT4vB8nLc'
    })
  })

  it.each([
    '::vshu-webhook{hook="wh_short"}',
    '::vshu-webhook{hook="wh_7Kx2pQ9mT4vB8nLc/vshuwh_key"}',
    '::vshu-webhook{}',
    '::vshu-webhook{hook="wh_7Kx2pQ9mT4vB8nLc" hook="wh_7Kx2pQ9mT4vB8nLd"}',
    '::vshu-visual{hook="wh_7Kx2pQ9mT4vB8nLc"}'
  ])('refuses %s', (line) => {
    expect(parseNativeChatWebhookDirectiveLine(line)).toBeNull()
  })

  it('is held while streaming and left out of plain text', () => {
    expect(isPendingNativeChatVisualDirectiveTail('::vshu-web')).toBe(true)
    expect(isPendingNativeChatVisualDirectiveTail('::vshu-webhook{hook="wh_7K')).toBe(true)
    expect(withoutNativeChatVisualDirectiveLines(`It’s live.\n\n${LINE}\n\nDone.`)).toBe(
      'It’s live.\n\nDone.'
    )
    expect(withoutNativeChatVisualDirectiveLines(`\`\`\`\n${LINE}\n\`\`\``)).toContain(LINE)
  })
})

describe('withLegacyNativeChatIdeasAsList', () => {
  it("lists an old transcript's idea lines by their text, leaving fenced code alone", () => {
    expect(
      withLegacyNativeChatIdeasAsList(
        'Pick one:\n::vshu-idea{text="Watch my PRs in vshu" app="github"}\n  ::vshu-idea{text="Answer #eng questions" needs="slack"}\n```\n::vshu-idea{text="x"}\n```'
      )
    ).toBe(
      'Pick one:\n- Watch my PRs in vshu\n- Answer #eng questions\n```\n::vshu-idea{text="x"}\n```'
    )
  })
})
