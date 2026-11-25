// A startVshud test that fails partway must not leave latches closed: later tests in the worker would wait 10 s.
import { afterEach } from 'vitest'
import { _resetVshudFeatureReadinessForTests } from '../../../../src/main/runtime/rpc/startup/vshud-readiness'

afterEach(() => {
  _resetVshudFeatureReadinessForTests()
})
