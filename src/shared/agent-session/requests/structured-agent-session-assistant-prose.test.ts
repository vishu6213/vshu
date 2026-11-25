import { expect, it } from 'vitest'
import type { NativeChatBlock } from '../../native-chat/native-chat-types'
import { assistantProse } from './structured-agent-session-assistant-prose'

const text = (value: string): NativeChatBlock => ({ type: 'text', text: value })

it('keeps a webhook key whole across the blocks that split it, and lines up other blocks', () => {
  expect(assistantProse([text('see vshuwh_ab'), text('cd'), text('12 done'), text('next')])).toBe(
    'see vshuwh_abcd12 done\nnext'
  )
  expect(assistantProse([text('k=%76shuwh_'), text('zz')])).toBe('k=%76shuwh_zz')
})
