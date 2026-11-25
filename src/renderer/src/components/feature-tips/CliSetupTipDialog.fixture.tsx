import { FEATURE_TIPS } from '../../../../shared/feature-education/feature-tips'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { CliSetupTipDialog } from './CliSetupTipDialog'

const tip = FEATURE_TIPS.find((item) => item.id === 'vshu-cli')
if (!tip) {
  throw new Error('vshu-cli feature tip is missing')
}

export const open = defineFixture({
  render: () => (
    <CliSetupTipDialog
      open
      tip={tip}
      primaryBusy={false}
      onOpenChange={() => {}}
      onPrimaryAction={() => {}}
      skillTerminalOpen={false}
      onSkip={() => {}}
    />
  )
})
