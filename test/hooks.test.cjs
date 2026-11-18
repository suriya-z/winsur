const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { installHooksToConfig, hookCommand } = require("../electron/hooks.cjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "winsur-hooks-"));
}

test("a config file with comments is left untouched instead of being replaced", () => {
  const dir = tempDir();
  const file = path.join(dir, "settings.json");
  const original = '{\n  // my editor settings\n  "editor.fontSize": 14,\n}\n';
  fs.writeFileSync(file, original, "utf8");

  assert.throws(() => installHooksToConfig(file, "C:\\h.ps1", "hooks", true, false, "windsurf"));
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("a config file with a UTF-8 BOM keeps its existing keys", () => {
  const dir = tempDir();
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, '\ufeff{"model":"opus","permissions":{"allow":["Bash(ls)"]}}', "utf8");

  installHooksToConfig(file, "C:\\h.ps1", "hooks", true, false, "claude-code");

  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.model, "opus");
  assert.deepEqual(saved.permissions, { allow: ["Bash(ls)"] });
  assert.ok(saved.hooks.Stop);
});

test("hookCommand escapes an apostrophe in a script path that has spaces", () => {
  const cmd = hookCommand("C:\\Users\\O'Neil Kumar\\hooks\\winsur-hook.ps1", "Stop");
  assert.ok(cmd.includes("'C:\\Users\\O''Neil Kumar\\hooks\\winsur-hook.ps1'"), cmd);
});

test("hookCommand runs a script whose path contains an apostrophe and a space", { skip: process.platform !== "win32" }, () => {
  const dir = path.join(tempDir(), "O'Neil Kumar");
  fs.mkdirSync(dir);
  const script = path.join(dir, "hook.ps1");
  const marker = path.join(dir, "ran.txt");
  fs.writeFileSync(script, 'param($e) Set-Content -LiteralPath "$PSScriptRoot\\ran.txt" -Value $e\n', "utf8");

  execSync(hookCommand(script, "Stop"), { stdio: "ignore" });

  assert.equal(fs.readFileSync(marker, "utf8").trim(), "Stop");
});
