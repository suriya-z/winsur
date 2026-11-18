const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The module reads its config dir at load time; keep it out of the real profile.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "winsur-ssh-"));
process.env.USERPROFILE = home;
process.env.HOME = home;
const ssh = require("../electron/ssh-remote.cjs");

test("a host that starts with a dash is rejected", () => {
  assert.throws(() => ssh.addRemote({ name: "evil", host: "-oProxyCommand=calc" }), /host/i);
});

test("connecting without an ssh binary reports disconnected instead of crashing", async () => {
  ssh.addRemote({ id: "lab", name: "Lab", host: "user@10.0.0.5" });
  const savedPath = process.env.PATH;
  process.env.PATH = home;
  try {
    ssh.connectRemote("lab");
  } finally {
    process.env.PATH = savedPath;
  }

  await new Promise((r) => setTimeout(r, 200));

  assert.equal(ssh.listRemotes().find((r) => r.id === "lab").connected, false);
});
