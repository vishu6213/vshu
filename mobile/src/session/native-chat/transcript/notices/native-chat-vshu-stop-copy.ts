import type { NativeChatVshuStopSay } from '../../../../../../src/shared/native-chat/transcript/continuation/native-chat-vshu-stop-words'
import type { Translate } from '../../../../i18n/mobile-i18n'

export function nativeChatVshuStopSay(t: Translate): NativeChatVshuStopSay {
  return (id, machine) => {
    const copy = {
      update: () =>
        t(
          'chat.vshuStop.update',
          'Vshu on {{machine}} restarted for an update while this response was in progress.',
          { machine }
        ),
      quit: () =>
        t(
          'chat.vshuStop.quit',
          'Vshu on {{machine}} was closed while this response was in progress.',
          { machine }
        ),
      crash: () =>
        t(
          'chat.vshuStop.crash',
          'Vshu on {{machine}} stopped unexpectedly while this response was in progress.',
          { machine }
        ),
      remote: () =>
        t(
          'chat.vshuStop.remote',
          'Vshu on {{machine}} stopped while this response was in progress.',
          { machine }
        ),
      canContinue: () => t('chat.vshuStop.canContinue', 'You can continue in this conversation.'),
      unnamedServer: () => t('chat.vshuStop.unnamedServer', 'the remote server')
    }
    return copy[id]()
  }
}
