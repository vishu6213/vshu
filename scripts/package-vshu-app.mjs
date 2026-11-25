// Local Windows packaging for Vshu.
//
//   node scripts/package-vshu-app.mjs              -> dist/Vshu/Vshu.exe (+ refreshes
//                                                     %LOCALAPPDATA%\Programs\vshu)
//   node scripts/package-vshu-app.mjs --installer  -> also builds the NSIS installer with
//                                                     config/electron-builder.simple.cjs
//                                                     and copies it to Vshu_Installer/.
//                                                     dist/ also gets latest.yml and the
//                                                     .blockmap that in-app updates read
//                                                     (scripts/release-vshu.mjs uploads them)
//   --skip-installed-refresh                        -> leave %LOCALAPPDATA%\Programs\vshu and
//                                                     running Vshu.exe processes untouched

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const distRoot = path.join(repoRoot, 'dist', 'Vshu')
const electronDist = path.join(repoRoot, 'node_modules', 'electron', 'dist')
const iconPath = path.join(repoRoot, 'resources', 'build', 'icon.ico')
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const version = pkg.version
const buildInstaller = process.argv.includes('--installer')
const refreshInstalled = !process.argv.includes('--skip-installed-refresh')
const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'))

console.log('=== PACKAGING VSHU APPLICATION ===')

// 1. Ensure out/ is built
if (
  !fs.existsSync(path.join(repoRoot, 'out', 'main', 'index.js')) ||
  !fs.existsSync(path.join(repoRoot, 'out', 'renderer', 'index.html'))
) {
  console.log('Building production bundle via electron-vite...')
  execFileSync(
    process.execPath,
    [
      path.join(
        repoRoot,
        'config',
        'scripts',
        'desktop-build',
        'execution',
        'run-electron-vite-build.mjs'
      )
    ],
    { stdio: 'inherit', cwd: repoRoot }
  )
}

// 2. Prepare dist/Vshu
if (fs.existsSync(distRoot)) {
  console.log('Cleaning old dist/Vshu...')
  fs.rmSync(distRoot, { recursive: true, force: true })
}
fs.mkdirSync(distRoot, { recursive: true })

// 3. Copy Electron binaries
console.log('Copying Electron runtime files...')
for (const file of fs.readdirSync(electronDist)) {
  if (file === 'resources') {
    continue
  }
  const src = path.join(electronDist, file)
  const dest = path.join(distRoot, file === 'electron.exe' ? 'Vshu.exe' : file)
  if (fs.statSync(src).isDirectory()) {
    fs.cpSync(src, dest, { recursive: true })
  } else {
    fs.copyFileSync(src, dest)
  }
}

// 4. Create resources/app
console.log('Creating resources/app bundle...')
const resourcesDir = path.join(distRoot, 'resources')
const appDir = path.join(resourcesDir, 'app')
fs.mkdirSync(appDir, { recursive: true })

const prodPkg = {
  name: 'vshu',
  version,
  description: pkg.description,
  main: './out/main/index.js'
}
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(prodPkg, null, 2), 'utf8')

// electron-updater needs resources/app-update.yml (the NSIS build writes its own from the
// publish block in config/electron-builder.simple.cjs; keep the two in sync).
fs.writeFileSync(
  path.join(resourcesDir, 'app-update.yml'),
  [
    'provider: github',
    'owner: vishu6213',
    'repo: vshu',
    'updaterCacheDirName: vshu-updater',
    ''
  ].join('\n'),
  'utf8'
)

console.log('Copying out/ into app/out...')
fs.cpSync(path.join(repoRoot, 'out'), path.join(appDir, 'out'), { recursive: true })

const unpackedOut = path.join(resourcesDir, 'app.asar.unpacked', 'out')
fs.mkdirSync(unpackedOut, { recursive: true })
fs.cpSync(path.join(repoRoot, 'out'), unpackedOut, { recursive: true })

console.log('Copying resources into app/resources...')
fs.cpSync(path.join(repoRoot, 'resources'), path.join(appDir, 'resources'), { recursive: true })

console.log('Copying bundled ripgrep binaries...')
fs.cpSync(
  path.join(repoRoot, 'node_modules', '@vscode', 'ripgrep-universal', 'bin'),
  path.join(resourcesDir, 'ripgrep'),
  { recursive: true }
)

console.log('Copying bundled bin launchers...')
const binDest = path.join(resourcesDir, 'bin')
fs.mkdirSync(binDest, { recursive: true })
fs.cpSync(path.join(repoRoot, 'resources', 'win32', 'bin'), binDest, { recursive: true })

// Mirror electron-builder.simple.cjs extraResources: bundled plugin bootstrap reads
// <resourcesPath>/plugins/launch/bundled-plugins.json, and skills resolve from <resourcesPath>/skills.
console.log('Copying bundled plugins and skills...')
for (const dir of ['plugins', 'skills']) {
  fs.cpSync(path.join(repoRoot, 'resources', dir), path.join(resourcesDir, dir), {
    recursive: true
  })
}

console.log('Linking node_modules...')
fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(appDir, 'node_modules'), 'junction')

// 5. Embed icon and version info with electron-builder's own resource editor
// (resedit, pure JS), resolved from node_modules instead of a cached rcedit.exe.
async function embedWindowsResources(exePath) {
  if (!fs.existsSync(iconPath)) {
    console.warn('No resources/build/icon.ico; skipping icon embedding.')
    return
  }
  try {
    const requireFromBuilder = createRequire(
      requireFromRepo.resolve('electron-builder/package.json')
    )
    const { editWindowsResources } = requireFromBuilder('app-builder-lib/out/util/resEdit')
    await editWindowsResources({
      file: exePath,
      iconPath,
      fileVersion: version,
      productVersion: `${version.replace(/[-+].*$/, '')}.0`,
      versionStrings: {
        FileDescription: 'Vshu IDE',
        ProductName: 'Vshu',
        CompanyName: 'Vshu Contributors',
        LegalCopyright: 'Copyright (c) 2026 Lovecast Inc. and Vshu Contributors',
        OriginalFilename: 'Vshu.exe',
        InternalName: 'Vshu'
      }
    })
    console.log('Embedded Vshu icon and version info into', exePath)
  } catch (err) {
    console.warn('Could not embed icon/version info:', err.message)
  }
}

const targetExe = path.join(distRoot, 'Vshu.exe')
await embedWindowsResources(targetExe)

console.log('=== VSHU APP PACKAGED SUCCESSFULLY AT: ===')
console.log(targetExe)

// 6. Update installed copy in %LOCALAPPDATA%\Programs\vshu if it exists
if (!refreshInstalled) {
  console.log('Skipping installed-app refresh (--skip-installed-refresh).')
} else if (process.env.LOCALAPPDATA) {
  const installedDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'vshu')
  console.log('Updating installed app at:', installedDir)
  try {
    execFileSync('taskkill', ['/F', '/IM', 'Vshu.exe', '/T'], { stdio: 'ignore' })
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
  } catch {
    // Not running.
  }
  try {
    fs.mkdirSync(installedDir, { recursive: true })
    fs.rmSync(path.join(installedDir, 'resources', 'app.asar'), { force: true })
    fs.rmSync(path.join(installedDir, 'resources', 'app'), { recursive: true, force: true })
    fs.cpSync(distRoot, installedDir, { recursive: true, force: true })
    if (fs.existsSync(iconPath)) {
      fs.copyFileSync(iconPath, path.join(installedDir, 'vshu-logo-bw.ico'))
      fs.copyFileSync(iconPath, path.join(installedDir, 'icon.ico'))
    }
    console.log('Successfully updated installed app at', installedDir)
  } catch (err) {
    console.warn('Could not copy to installed dir:', err.message)
  }
}

// 7. Optional NSIS installer -> dist/ and Vshu_Installer/
if (buildInstaller) {
  console.log('Building the Vshu installer (electron-builder.simple.cjs)...')
  const builderCli = path.join(
    path.dirname(requireFromRepo.resolve('electron-builder/package.json')),
    'cli.js'
  )
  execFileSync(
    process.execPath,
    // Never upload from here: releases are published by scripts/release-vshu.mjs or CI.
    [builderCli, '--config', 'config/electron-builder.simple.cjs', '--win', '--publish', 'never'],
    { stdio: 'inherit', cwd: repoRoot }
  )
  // Must match win.artifactName in config/electron-builder.simple.cjs.
  const installerName = `Vshu-${version}-windows-setup.exe`
  const installerSrc = path.join(repoRoot, 'dist', installerName)
  if (!fs.existsSync(installerSrc)) {
    throw new Error(`Installer not found at ${installerSrc}`)
  }
  const installerDir = path.join(repoRoot, 'Vshu_Installer')
  fs.mkdirSync(installerDir, { recursive: true })
  fs.copyFileSync(installerSrc, path.join(installerDir, installerName))
  console.log('Installer copied to', path.join(installerDir, installerName))
  for (const updateFile of ['latest.yml', `${installerName}.blockmap`]) {
    if (!fs.existsSync(path.join(repoRoot, 'dist', updateFile))) {
      throw new Error(`dist/${updateFile} is missing; in-app updates need it in the release.`)
    }
  }
  console.log('Update metadata: dist/latest.yml and', `dist/${installerName}.blockmap`)
}
