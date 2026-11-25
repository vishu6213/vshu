'use strict'

let addon = null
function getFocusAssistState() {
  addon ??= require('./build/Release/vshu_windows_notifications.node')
  return addon.getFocusAssistState()
}

module.exports = { getFocusAssistState }
