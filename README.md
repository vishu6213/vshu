<h1 align="center">
  <img src="resources/build/icon.png" alt="Vshu" width="64" valign="middle" /> Vshu
</h1>

<p align="center">
  <a href="https://github.com/vishu6213/vshu/releases/latest"><img src="https://img.shields.io/github/v/release/vishu6213/vshu?style=flat-square&color=black&label=release" alt="Latest release" /></a>
  <a href="https://github.com/vishu6213/vshu/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/vishu6213/vshu/ci.yml?branch=master&style=flat-square&label=CI" alt="CI status" /></a>
  <img src="https://img.shields.io/badge/License-MIT-black?style=flat-square" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Platform-Windows-black?style=flat-square" alt="Platform: Windows" />
</p>

<p align="center">
  <strong>An IDE for running many AI coding agents in parallel.</strong><br/>
  Run Claude Code, Codex, OpenCode and other agents side by side, each in its own Git worktree,
  with a built-in terminal, browser, diff review and a true-black interface.
</p>

---

## What is Vshu?

Vshu is a desktop IDE (Electron + TypeScript) built around agentic development: you give each
task its own worktree, start an agent in it, and review, test and merge the results from one
window.

## Features

- **Parallel agents.** Dispatch Claude Code, Codex, OpenCode and other CLI agents across
  separate worktrees at the same time, and watch their status from one sidebar.
- **Worktree-first Git.** Create, switch and clean up worktrees; review agent changes as
  unified diffs, annotate them, and commit or open pull requests.
- **Chat or terminal.** Talk to an agent in a chat view or drop into its full terminal without
  losing context.
- **Built-in browser.** Preview web apps, inspect elements and let agents drive the page.
- **Remote and WSL.** Work on SSH hosts and WSL distributions as if they were local.
- **Plugins and themes.** Extend Vshu with themes, language packs and agent tools.
- **True-black UI.** A pure black (`#000000`) monochrome theme that is easy on OLED screens.
- **In-app updates.** New releases install from Settings with one click (see
  [Updates](#updates)).

## Screenshots

<p align="center">
  <img src="docs/assets/screenshots/vshu-workspace.png" alt="Vshu workspace" width="820" />
</p>
<p align="center">
  <img src="docs/assets/screenshots/vshu-settings-agents.png" alt="Agent settings" width="820" />
</p>

## Download

Get the latest Windows installer, `Vshu-<version>-windows-setup.exe`, from
[**GitHub Releases**](https://github.com/vishu6213/vshu/releases/latest).

The installer is per-user: it installs to `%LOCALAPPDATA%\Programs\vshu`, needs no
administrator rights, and adds Start menu and desktop shortcuts.

> **Windows SmartScreen.** Vshu builds are not code-signed yet, so the first time you run
> the installer Windows may show "Windows protected your PC". Click **More info**, then
> **Run anyway**. Updates installed from inside Vshu do not show this prompt.

## Updates

Vshu updates itself from this repository's GitHub Releases:

1. Vshu checks for a newer release when it starts and about once a day after that. You can
   also click **Check for updates** in **Settings > General** (or use the app menu).
2. It reads the newest release's `latest.yml` (the version, installer name and SHA-512).
   The repository is public, so no account or token is needed.
3. Vshu downloads the installer (only the changed blocks when it can, using the
   `.blockmap`), verifies its SHA-512, and offers **Restart to Update**.
4. The installer runs silently in the per-user install folder and relaunches Vshu.

Because the builds are unsigned, no publisher name is configured, so Vshu does not require
an Authenticode signature on updates; the SHA-512 in `latest.yml` still protects the download.
Draft releases are invisible to the updater until they are published. Maintainers: see
[RELEASING.md](RELEASING.md).

## Building from source (Windows)

Prerequisites:

- [Node.js](https://nodejs.org/) 24 and Git
- pnpm: `corepack enable pnpm` (the version is pinned by `packageManager`)
- Optional: Visual Studio 2022 Build Tools with "Desktop development with C++". Without it,
  `pnpm run ensure:electron-runtime` downloads prebuilt, checksum-pinned native addons
  instead of compiling them. Rust is not needed for the installer.

```bash
git clone https://github.com/vishu6213/vshu.git
cd vshu
pnpm install
pnpm dev                 # run in development mode
```

Build the installer:

```bash
pnpm run build:cli
pnpm run build:electron-vite
pnpm run ensure:electron-runtime
pnpm package:vshu        # dist/Vshu/Vshu.exe and Vshu_Installer/Vshu-<version>-windows-setup.exe
```

`pnpm package:vshu` uses `config/electron-builder.simple.cjs` and also writes `latest.yml`
and the installer `.blockmap` to `dist/`. `pnpm release:build` runs all of the above from a
clean output folder. `config/electron-builder.config.cjs` is the full upstream release
configuration (signing, macOS, Linux) and needs extra native tools.

Useful checks: `pnpm run typecheck`, `pnpm exec oxlint`, `pnpm rebrand:check`.

## License

Vshu is open-source software licensed under the [MIT License](LICENSE).
