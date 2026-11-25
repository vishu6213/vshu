# Releasing Vshu

Every GitHub Release of [vishu6213/vshu](https://github.com/vishu6213/vshu/releases) is an
update for installed copies of Vshu. A release needs three assets, all written to `dist/` by
the build:

| Asset                                       | Purpose                                               |
| ------------------------------------------- | ----------------------------------------------------- |
| `Vshu-<version>-windows-setup.exe`          | the per-user NSIS installer                           |
| `Vshu-<version>-windows-setup.exe.blockmap` | lets the updater download only changed blocks         |
| `latest.yml`                                | version, installer name and SHA-512 the updater reads |

Installed apps compare their version with the newest published release, so the version must
go up every time.

## 1. Bump the version

Edit `"version"` in `package.json` (for example `1.0.0` to `1.0.1`), then commit and push:

```bash
git commit -am "chore: release 1.0.1"
git push origin master
```

Use a prerelease version such as `1.1.0-rc.1` to publish a release only users on the RC
channel are offered.

## 2a. Publish from GitHub Actions (tag)

```bash
git tag v1.0.1
git push origin v1.0.1
```

`.github/workflows/release.yml` builds the installer on `windows-latest` and creates the
release with the three assets, using the workflow's own `GITHUB_TOKEN` (no secrets to set up).
The tag must equal `v` + the `package.json` version or the workflow stops. To rebuild an
existing tag, run the workflow manually from the Actions tab with that tag.

Push only the one tag (`git push origin v1.0.1`), never `git push --tags`: the local clone
may hold upstream's tags, which would show up as releases of this repository.

## 2b. Publish from your machine

With the [GitHub CLI](https://cli.github.com/) logged in (`gh auth login`, as an account
that can write to the repository):

```bash
pnpm release:win                                # build, then create release v<version>
pnpm release:win -- --notes-file notes.md       # with your own release notes
pnpm release:win -- --draft                     # draft: publish it on GitHub later
pnpm release:build                              # build only, no upload
pnpm release:win -- --skip-build                # upload an existing dist/ build
```

`scripts/release-vshu.mjs` cleans `out/`, runs `build:cli`, `build:electron-vite`,
`ensure:electron-runtime` and `package-vshu-app.mjs --installer`, checks that `latest.yml`
matches the installer, then runs `gh release create v<version>` with the three assets. Your
commit must already be pushed; the tag is created on GitHub if it does not exist.

## 3. Check it

- The release page lists the installer, its `.blockmap` and `latest.yml`, and is not a draft.
- An installed older Vshu finds the update with **Check for updates** in **Settings >
  General** and installs it with **Restart to Update**.

Builds are unsigned: first-time installs from the browser show a SmartScreen warning
("More info" > "Run anyway"); in-app updates do not. If you later sign the installer, set
`VSHU_WIN_PUBLISHER_NAME` only for `config/electron-builder.config.cjs`, and remember that
once installed apps know a publisher name they reject updates signed by anyone else.
