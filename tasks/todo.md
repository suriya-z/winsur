# Todo: One-file download

## Task 1: Build only `Winsur-Setup.exe`, published as a full release

**Description:** Drop the portable target and give the installer a version-free
name, so a single stable URL can point at the latest installer. Publish as a
full release instead of a draft, and bump the version to match the first tag.

**Acceptance criteria:**
- [ ] `build.win.target` lists only `nsis`; the `portable` block is gone
- [ ] `build.win.artifactName` is `${productName}-Setup.${ext}`
- [ ] `build.publish[0].releaseType` is `release`; `version` is `0.1.2`

**Verification:**
- [ ] Tests pass: `npm test`
- [ ] Build succeeds: `npm run electron:build`
- [ ] Manual check: `release/` contains `Winsur-Setup.exe` and no portable `.exe` from this build

**Dependencies:** None

**Files likely touched:**
- `package.json`

**Estimated scope:** XS

## Task 2: README shows one download button

**Description:** Replace the two-file table with a single link to
`https://github.com/suriya-z/winsur/releases/latest/download/Winsur-Setup.exe`,
plus one line saying Windows 10/11 x64. Keep the unsigned-installer note.

**Acceptance criteria:**
- [ ] README Download section has exactly one download link, to `Winsur-Setup.exe`
- [ ] No mention of `Portable` remains in README

**Verification:**
- [ ] Manual check: rendered README on GitHub shows one button-style link

**Dependencies:** Task 1

**Files likely touched:**
- `README.md`

**Estimated scope:** XS

## Checkpoint: Local

- [ ] `npm test`, `npm run lint`, `npm run build` pass
- [ ] Exactly one installer built
- [ ] User reviews before push and tag

## Task 3: Publish v0.1.2

**Description:** Commit, push `main`, tag `v0.1.2` and push the tag. The
Release workflow builds on `windows-latest` and publishes the release.

**Acceptance criteria:**
- [ ] Release `v0.1.2` is public (not draft) with asset `Winsur-Setup.exe`
- [ ] The README link returns the installer

**Verification:**
- [ ] `gh release view v0.1.2 -R suriya-z/winsur` lists `Winsur-Setup.exe`
- [ ] `curl -sIL https://github.com/suriya-z/winsur/releases/latest/download/Winsur-Setup.exe` ends in `200`
- [ ] Manual check: install, launch, `http://127.0.0.1:18900/health` answers

**Dependencies:** Tasks 1-2, user approval (public release)

**Files likely touched:** none (git tag only)

**Estimated scope:** XS

## Checkpoint: Complete

- [ ] One-click download works for a logged-out visitor
