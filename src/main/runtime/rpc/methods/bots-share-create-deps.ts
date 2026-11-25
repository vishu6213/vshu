// What making a bot from a shared link or a built-in template uses of the runtime: its bots, the review
// the owner opened, and the normal automation create for each schedule, turned off.
import { botsRootFolder, localBotHomeFilesystem } from '../../../bots/bot-home'
import type { BotShareCreateDeps } from '../../../bots/sharing/bot-share-create'
import type { VshuRuntimeService } from '../../vshu-runtime'

export function botShareCreateDeps(runtime: VshuRuntimeService): BotShareCreateDeps {
  return {
    bots: runtime.bots,
    filesystem: localBotHomeFilesystem,
    botsRoot: () => botsRootFolder(),
    reviewed: (reviewId) => runtime.botShares().reviewed(reviewId),
    createPausedSchedule: async (bot, schedule) => {
      await runtime.createAutomation({
        name: schedule.name,
        prompt: schedule.prompt,
        agentId: bot.agent,
        bot: { botId: bot.id, runsIn: 'new', resultsTo: 'chat' },
        rrule: schedule.rrule,
        dtstart: Date.now(),
        ...(schedule.timezone ? { timezone: schedule.timezone, timezoneExplicit: true } : {}),
        enabled: false
      })
    }
  }
}
