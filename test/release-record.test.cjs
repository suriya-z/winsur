const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sha256File, verifyArtifact } = require("../scripts/release-record.cjs");

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "winsur-release-"));
  const file = path.join(dir, "Winsur-Setup.exe");
  fs.writeFileSync(file, content);
  return file;
}

test("sha256File returns the SHA-256 of the file's bytes", async () => {
  // Known-good value from FIPS 180-2 for the message "abc".
  const file = tempFile("abc");
  assert.equal(
    await sha256File(file),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("verifyArtifact refuses an installer whose bytes differ from the tested one", async () => {
  const tested = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; // "abc"
  assert.equal((await verifyArtifact(tempFile("abc"), tested)).ok, true);

  const rebuilt = await verifyArtifact(tempFile("abd"), tested);
  assert.equal(rebuilt.ok, false);
  assert.notEqual(rebuilt.actual, tested);
});

test("the verify command exits non-zero when the installer does not match", () => {
  const { spawnSync } = require("child_process");
  const cli = path.join(__dirname, "..", "scripts", "release-record.cjs");
  const tested = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; // "abc"

  assert.equal(spawnSync(process.execPath, [cli, "verify", tempFile("abc"), tested]).status, 0);
  assert.equal(spawnSync(process.execPath, [cli, "verify", tempFile("abd"), tested]).status, 1);
});