# Implementation Plan: One-file download for Winsur

## Overview

Users see two `.exe` files in the README and no actual release to download.
Goal: one file, one click. The README links straight to `Winsur-Setup.exe`
on the latest GitHub release, and a public release exists for that link to
resolve to.

## Findings

- `gh release list -R suriya-z/winsur` is empty and there are no git tags, so
  the current "Download the latest release" link shows an empty releases page.
- `package.json` builds two targets: `nsis` (installer) and `portable`.
- The portable build extracts itself to a new temp folder on every run. The
  command-based hooks (Cursor, Codex, Antigravity) store the path of
  `hooks/winsur-hook.ps1` from that temp folder, so they break after the app
  closes. Only the installer gives the hook script a stable path.
- `artifactName` includes the version (`Winsur-Setup-0.1.1.exe`), so no fixed
  URL can point at "the latest installer".
- electron-builder's GitHub publisher creates a draft release by default, so
  a tag push alone would not make anything downloadable.

## Architecture Decisions

- **Ship only the NSIS installer.** It gives the hook script a stable path, adds
  Start Menu entries and an uninstaller. The portable build is dropped.
- **Version-free asset name `Winsur-Setup.exe`.** This makes
  `https://github.com/suriya-z/winsur/releases/latest/download/Winsur-Setup.exe`
  a permanent one-click link.
- **Publish as a full release, not a draft** (`releaseType: "release"`).
- **Release v0.1.2** so the tag matches `package.json` version.

## Task List

### Phase 1: Single artifact

- [ ] Task 1: Build only `Winsur-Setup.exe`, published as a full release
- [ ] Task 2: README shows one download button pointing at that file

### Checkpoint: Local

- [ ] `npm test`, `npm run lint`, `npm run build` pass
- [ ] `npm run electron:build` leaves exactly one `.exe` in `release/`
- [ ] Review with user before anything is pushed or tagged

### Phase 2: First public release

- [ ] Task 3: Tag `v0.1.2`, let the Release workflow publish, confirm the link

### Checkpoint: Complete

- [ ] The README link downloads `Winsur-Setup.exe` in a logged-out browser
- [ ] The installed app starts and the hook server answers on `127.0.0.1:18900/health`

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Release workflow fails on `windows-latest` (it has never run) | High | Run `npm run electron:build` locally first; read the Actions log if the tag build fails |
| Users who already have `Winsur-Portable-*.exe` lose it | Low | No public release ever shipped it |
| SmartScreen still warns on the unsigned installer | Med | Already explained in README; code signing is out of scope |

## Open Questions

- Should the installer be one-click (`nsis.oneClick: true`: no wizard, installs
  for the current user straight away), or keep the current wizard that asks for
  an install folder?
