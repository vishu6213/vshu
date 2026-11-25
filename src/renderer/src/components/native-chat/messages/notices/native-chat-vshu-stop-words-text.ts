import { translate } from '@/i18n/i18n'
import {
  NATIVE_CHAT_VSHU_STOP_COPY as COPY,
  type NativeChatVshuStopCopyId,
  type NativeChatVshuStopSay
} from '../../../../../../shared/native-chat/transcript/continuation/native-chat-vshu-stop-words'

const PIECES: Record<NativeChatVshuStopCopyId, (machine: string | undefined) => string> = {
  update: (machine) =>
    translate('components.native-chat.notices.vshuStopUpdate', COPY.update, { machine }),
  quit: (machine) =>
    translate('components.native-chat.notices.vshuStopQuit', COPY.quit, { machine }),
  crash: (machine) =>
    translate('components.native-chat.notices.vshuStopCrash', COPY.crash, { machine }),
  remote: (machine) =>
    translate('components.native-chat.notices.vshuStopRemote', COPY.remote, { machine }),
  canContinue: () =>
    translate('components.native-chat.notices.vshuStopCanContinue', COPY.canContinue),
  unnamedServer: () =>
    translate('components.native-chat.notices.vshuStopUnnamedServer', COPY.unnamedServer)
}

export const sayNativeChatVshuStopTranslated: NativeChatVshuStopSay = (id, machine) =>
  PIECES[id](machine)
