const test = require("node:test");
const assert = require("node:assert/strict");
const { psQuote, runPsFile, scoreAndPickPs } = require("../electron/window.cjs");

test("the send script has no fallback to an arbitrary console window", () => {
  const script = scoreAndPickPs("'claude'", "claude", { allowAnyConsole: false });
  assert.ok(!script.includes("Last-resort"), "send must never pick an unrelated console window");
});

test("the jump script still falls back to any console window", () => {
  const script = scoreAndPickPs("'claude'", "claude", { allowAnyConsole: true });
  assert.ok(script.includes("Last-resort"));
});

test("psQuote doubles straight and curly single quotes", () => {
  assert.equal(psQuote("Bob’s 'app'"), "'Bob’’s ''app'''");
});

for (const name of ["Bob’s project", "café ő 日本", "x'; Write-Output INJECTED; '"]) {
  test(`a quoted folder name round-trips through PowerShell unchanged: ${name}`, { skip: process.platform !== "win32" }, async () => {
    const { stdout } = await runPsFile(
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8\nWrite-Output ${psQuote(name)}`
    );
    assert.equal(stdout, name);
  });
}
