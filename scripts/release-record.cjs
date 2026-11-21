// Hash a built installer so the file uploaded later is provably the one tested.

const crypto = require("crypto");
const fs = require("fs");

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifyArtifact(file, expected) {
  const actual = await sha256File(file);
  return { ok: actual === expected, actual };
}

module.exports = { sha256File, verifyArtifact };

// node scripts/release-record.cjs hash <file>
// node scripts/release-record.cjs verify <file> <sha256>
if (require.main === module) {
  const [cmd, file, expected] = process.argv.slice(2);
  (async () => {
    if (cmd === "hash" && file) {
      console.log(await sha256File(file));
    } else if (cmd === "verify" && file && expected) {
      const { ok, actual } = await verifyArtifact(file, expected.toLowerCase());
      console.log(ok ? `OK ${actual}` : `MISMATCH expected ${expected} got ${actual}`);
      process.exitCode = ok ? 0 : 1;
    } else {
      console.error("usage: release-record.cjs hash <file> | verify <file> <sha256>");
      process.exitCode = 2;
    }
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 2;
  });
}
