// Local Windows packaging (dist/ + Vshu_Installer/), used by
// scripts/package-vshu-app.mjs --installer. The release config is
// config/electron-builder.config.cjs; keep appId, productName and the
// protocol in sync with it.

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
  asarUnpack: [
    'out/main/**',
    'out/cli/**',
    'native/**',
    'resources/plugins/**',
    'resources/skills/**',
    'node_modules/@vshu/**'
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
    }
  ],
  directories: {
    output: 'dist',
    buildResources: 'resources/build'
  },
  // Rust launchers leave cargo target/ dirs (~40 MB of build-script intermediates) under native/.
  files: ['out/**/*', 'native/**/*', '!native/*/target{,/**/*}', 'resources/**/*', 'package.json'],
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
    createStartMenuShortcut: true
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
