// Local & GitHub Release Windows packaging (dist/ + Vshu_Installer/), used by
// scripts/package-vshu-app.mjs --installer. The cross-platform release config is
// config/electron-builder.config.cjs; keep appId, productName and the
// protocol in sync with it.
const { existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { copyPackagedTranscribeCpp } = require('./packaged-transcribe-cpp.cjs')
const {
  normalizeElectronArchitecture,
  prunePackagedRuntimeNodeModules,
  readPackage
} = require('./packaged-runtime-node-modules.cjs')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // Must equal the Windows AppUserModelId set at runtime
  // (src/main/startup/profile-startup/dev-instance-identity.ts) so taskbar
  // pins and toast notifications attach to the installed shortcut.
  appId: 'dev.vshu.app',
  productName: 'Vshu',
  copyright: 'Copyright (c) 2026 Lovecast Inc. and Vshu Contributors',
  protocols: [{ name: 'Vshu', schemes: ['vshu'] }],
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  asar: true,
  // Node-mode entries (resources/bin/vshu.cmd runs out/cli with ELECTRON_RUN_AS_NODE, plus
  // daemon/worker forks) cannot read app.asar, and out/cli requires ../../shared and
  // out/package.json's CommonJS boundary, so unpack all of out/ (the release config unpacks
  // the same closure piecemeal).
  asarUnpack: [
    'out/**',
    'native/**',
    'resources/plugins/**',
    'resources/skills/**',
    'node_modules/**'
  ],
  extraResources: [
    {
      from: 'node_modules/@vscode/ripgrep-universal/bin',
      to: 'ripgrep',
      filter: ['win32-x64/**', 'win32-arm64/**', 'linux-x64/**', 'darwin-x64/**', 'darwin-arm64/**']
    },
    {
      from: 'resources/plugins',
      to: 'plugins',
      filter: ['**/*']
    },
    {
      from: 'resources/skills',
      to: 'skills',
      filter: ['**/*']
    },
    {
      from: 'resources/win32/bin',
      to: 'bin',
      filter: ['**/*']
    },
    // Embedded-browser automation (`vshu browser ...`): main resolves the driver at
    // <resourcesPath>/agent-browser-win32-x64.exe, and the driver finds its version-matched
    // command catalog via the nearest skills/ above it. Mirrors config/electron-builder.config.cjs.
    {
      from: 'node_modules/@agent-browser/cli-win32-x64-msvc/bin/agent-browser.exe',
      to: 'agent-browser-win32-x64.exe'
    },
    { from: 'node_modules/agent-browser/skills/agent-browser', to: 'skills/agent-browser' },
    { from: 'node_modules/agent-browser/skill-data', to: 'skill-data' },
    { from: 'native/computer-use-windows/runtime.ps1', to: 'computer-use-windows/runtime.ps1' },
    { from: 'resources/native-chat-visuals', to: 'native-chat-visuals' },
    { from: 'resources/onboarding/feature-wall', to: 'onboarding/feature-wall' },
    {
      from: 'node_modules/emojibase-data/en/shortcodes/emojibase.json',
      to: 'node_modules/emojibase-data/en/shortcodes/emojibase.json'
    },
    ...(existsSync(resolve(__dirname, '../out/relay')) ? [{ from: 'out/relay', to: 'relay' }] : [])
  ],
  async afterPack(context) {
    const resourcesDir = join(context.appOutDir, 'resources')
    const arch = normalizeElectronArchitecture(context.arch)
    try {
      copyPackagedTranscribeCpp(readPackage, resourcesDir, context.electronPlatformName, arch)
    } catch (error) {
      console.warn('[package] Skipping transcribe-cpp CRT copy:', error?.message ?? error)
    }
    prunePackagedRuntimeNodeModules(resourcesDir, context.electronPlatformName, context.arch)
  },
  directories: {
    output: 'dist',
    buildResources: 'resources/build'
  },
  // Rust launchers leave cargo target/ dirs and pnpm leaves node_modules junctions (e.g.
  // compile-time node-addon-api) under native/, which break 7za during NSIS packing on CI.
  files: [
    'out/**/*',
    '!out/**/*.map',
    '!out/relay{,/**/*}',
    'native/**/*',
    '!native/*/target{,/**/*}',
    '!native/**/node_modules{,/**/*}',
    'resources/**/*',
    'package.json'
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // electron-builder embeds the icon and version strings itself (resedit),
    // so no rcedit afterPack hook is needed.
    icon: 'resources/build/icon.ico',
    executableName: 'Vshu',
    // No spaces: GitHub renames spaced asset names, which would break the url in latest.yml.
    // The "-windows-setup.exe" suffix is what the updater looks for as the Windows installer.
    artifactName: 'Vshu-${version}-windows-setup.${ext}'
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    deleteAppDataOnUninstall: false,
    shortcutName: 'Vshu',
    runAfterFinish: false,
    installerIcon: 'resources/build/icon.ico',
    uninstallerIcon: 'resources/build/icon.ico',
    installerHeaderIcon: 'resources/build/icon.ico',
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    include: resolve(__dirname, 'nsis', 'vshu-installer-hooks.nsh')
  },
  // In-app updates. Declaring a publisher makes electron-builder write latest.yml and the
  // installer .blockmap next to the installer, and resources/app-update.yml into the app
  // (electron-updater cannot run without it). Uploading is done by scripts/release-vshu.mjs
  // (gh release create) or .github/workflows/release.yml, so builds pass --publish never.
  // Public repo, so clients need no token. No publisherName or signing is configured, so
  // electron-updater skips the Authenticode publisher check and unsigned updates install.
  publish: {
    provider: 'github',
    owner: 'vishu6213',
    repo: 'vshu',
    releaseType: 'release'
  }
}
