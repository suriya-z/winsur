// Capture the README screenshots and demo GIF from the real app.
//   npx vite build && node scripts/readme-shots.cjs
// Runs Winsur against a temp home folder (see test/e2e/harness.cjs), feeds it
// demo agent events over the hook server, and writes docs/images/*.
// Needs port 18900 free and ffmpeg on PATH for the GIF.
// Never clicks Approve plan or sends a reply: those type into a real terminal.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { launchApp, post, holdPermission, ROOT } = require("../test/e2e/harness.cjs");

const OUT = path.join(ROOT, "docs", "images");
const BACKDROP = "linear-gradient(180deg, #16181d 0%, #0d0e11 100%)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function event(agent, folder, body) {
  return post("/hooks/event", {
    session_id: `${agent}-${folder}`,
    cwd: `C:\\code\\${folder}`,
    agent_type: agent,
    ...body,
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };

  try {
    // 2x pixels so the images stay sharp on high-DPI screens.
    const { app, win } = await launchApp(t, { electronArgs: ["--force-device-scale-factor=2"] });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(500, 700));
    // The window is transparent; give screenshots a dark desktop to sit on.
    await win.addStyleTag({ content: `html, body { background: ${BACKDROP} !important; }` });

    const island = () => win.locator("#root > div > div").first();
    const shotIsland = async (name, pad = 28) => {
      const box = await island().boundingBox();
      await win.screenshot({
        path: path.join(OUT, name),
        clip: {
          x: Math.max(0, box.x - pad),
          y: 0,
          width: Math.min(500, box.width + pad * 2),
          height: box.y + box.height + pad,
        },
      });
    };

    // 1. A plan waiting for review.
    await event("claude-code", "winsur", {
      hook_event_name: "Plan",
      plan: [
        "## Add dark mode",
        "",
        "1. Add color tokens for light and dark themes",
        "2. Read the Windows theme on startup",
        "3. Switch tokens when the theme changes",
        "4. Add a toggle in Settings",
      ].join("\n"),
    });
    await win.getByText("Add dark mode").waitFor();
    await sleep(600);
    await shotIsland("plan.png");
    await win.getByText("Dismiss", { exact: true }).click();
    await win.getByText("Add dark mode").waitFor({ state: "detached" });

    // 2. Three agents busy in three projects, island collapsed.
    await event("codex", "api-server", { hook_event_name: "PreToolUse", tool_name: "Edit" });
    await event("cursor", "landing-page", { hook_event_name: "PreToolUse", tool_name: "Read" });
    await event("claude-code", "winsur", { hook_event_name: "PreToolUse", tool_name: "Grep" });
    await win.keyboard.press("Escape");
    await win.getByText(/3 working/).waitFor();
    await sleep(600);
    await shotIsland("collapsed.png");

    // 3. GIF: collapsed, a permission request opens the island, Allow.
    const frames = fs.mkdtempSync(path.join(os.tmpdir(), "winsur-frames-"));
    let n = 0;
    const started = Date.now();
    const record = async (ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await win.screenshot({
          path: path.join(frames, `f${String(n++).padStart(4, "0")}.png`),
          clip: { x: 0, y: 0, width: 500, height: 470 },
          scale: "css",
        });
      }
    };

    await record(1400);
    const held = holdPermission({
      hook_event_name: "PreToolUse",
      session_id: "claude-code-winsur",
      cwd: "C:\\code\\winsur",
      agent_type: "claude-code",
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
    });
    await record(2400);
    await win.getByText("git push origin main").waitFor();
    await shotIsland("permission.png");
    await win.getByRole("button", { name: /Allow/ }).hover();
    await record(900);
    await win.getByRole("button", { name: /Allow/ }).click();
    await held.decision;
    await record(1800);
    const seconds = (Date.now() - started) / 1000;

    const gif = path.join(OUT, "demo.gif");
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-framerate", (n / seconds).toFixed(2),
      "-i", path.join(frames, "f%04d.png"),
      "-vf", "fps=15,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
      gif,
    ]);
    fs.rmSync(frames, { recursive: true, force: true });
    console.log(`frames=${n} seconds=${seconds.toFixed(1)}`);
    for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size);
  } finally {
    for (const fn of cleanups.reverse()) await fn();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
