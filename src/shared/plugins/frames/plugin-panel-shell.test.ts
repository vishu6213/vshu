// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { buildPluginPanelShellHtml } from './plugin-panel-shell'

describe('buildPluginPanelShellHtml', () => {
  it('applies a theme message from the host in place, and only from the host', () => {
    const html = buildPluginPanelShellHtml('<main>Plugin</main>')
    const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1]
    window.eval(script!.replaceAll('configurable: false', 'configurable: true'))
    document.documentElement.className = 'light keep'
    const style = document.createElement('style')
    style.id = 'vshu-design-tokens'
    style.textContent = ':root{--vshu-background:white}'
    document.head.appendChild(style)
    const theme = {
      vshu: 1,
      kind: 'evt',
      event: 'theme',
      payload: { colorScheme: 'dark', tokens: '--vshu-background:black' }
    }

    window.dispatchEvent(new MessageEvent('message', { data: theme, source: null }))
    expect(document.documentElement.className).toBe('light keep')

    window.dispatchEvent(new MessageEvent('message', { data: theme, source: window.parent }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('keep')).toBe(true)
    expect(style.textContent).toBe(':root{--vshu-background:black}')

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { ...theme, payload: { ...theme.payload, tokens: '}</style><script>x</script>{' } },
        source: window.parent
      })
    )
    expect(style.textContent).toBe(':root{/stylescriptx/script}')
    style.remove()
  })
})
