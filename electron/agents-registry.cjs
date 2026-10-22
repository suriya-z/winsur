// Zero-config agent matrix — detect + install hooks for every supported CLI/IDE
// Paths are best-effort Windows locations; missing = "not detected" (not an error)

const path = require("path");

function home() {
  return process.env.USERPROFILE || process.env.HOME || "";
}
function appdata() {
  return process.env.APPDATA || "";
}
function localappdata() {
  return process.env.LOCALAPPDATA || "";
}
function h(...parts) {
  const base = home();
  return base ? path.join(base, ...parts) : null;
}
function a(...parts) {
  const base = appdata();
  return base ? path.join(base, ...parts) : null;
}
function l(...parts) {
  const base = localappdata();
  return base ? path.join(base, ...parts) : null;
}

/**
 * kind:
 *  - settings: JSON with hooks key (Claude-style merge)
 *  - grok: ~/.xxx/hooks/winsur.json file
 *  - cursor: hooks.json style
 *  - codex: ~/.codex/hooks.json + config.toml trusted_hash
 *  - antigravity: ~/.gemini/config/hooks.json (must print JSON output)
 *  - hermes: %LOCALAPPDATA%\hermes\plugins\winsur (+ config.yaml hooks.outbound)
 *  - opencode: ~/.config/opencode/plugins/winsur.js
 */
function getAgentRegistry() {
  return [
    { name: "Claude Code", key: "claude_code", typeId: "claude-code", kind: "settings", configPath: h(".claude", "settings.json"), hooksKey: "hooks", detectDirs: [h(".claude")], binNames: ["claude"], windowHints: ["claude", "Claude Code"] },
    { name: "Claude Desktop", key: "claude_desktop", typeId: "claude-desktop", kind: "settings", configPath: a("Claude", "settings.json"), hooksKey: "hooks", detectDirs: [a("Claude")], windowHints: ["Claude"] },
    { name: "Codex CLI", key: "codex", typeId: "codex", kind: "codex", configPath: h(".codex", "hooks.json"), hooksKey: "hooks", detectDirs: [h(".codex")], binNames: ["codex"], windowHints: ["codex", "Codex"] },
    { name: "Grok Build", key: "grok_build", typeId: "grok-build", kind: "grok", configPath: h(".grok", "hooks", "winsur.json"), hooksKey: "hooks", detectDirs: [h(".grok")], binNames: ["grok"], windowHints: ["grok", "Grok", "xAI"] },
    { name: "Cursor", key: "cursor", typeId: "cursor", kind: "cursor", configPath: h(".cursor", "hooks.json"), hooksKey: "hooks", detectDirs: [h(".cursor"), a("Cursor")], binNames: ["cursor"], windowHints: ["Cursor"] },
    { name: "Windsurf", key: "windsurf", typeId: "windsurf", kind: "settings", configPath: a("Windsurf", "User", "settings.json"), hooksKey: "hooks", detectDirs: [a("Windsurf"), h(".codeium")], binNames: ["windsurf"], windowHints: ["Windsurf"] },
    { name: "Antigravity", key: "antigravity", typeId: "antigravity", kind: "antigravity", configPath: h(".gemini", "config", "hooks.json"), hooksKey: "winsur", detectDirs: [h(".gemini", "antigravity"), h(".antigravity"), h(".antigravity-ide"), a("Antigravity"), a("Antigravity IDE"), l("Programs", "Antigravity IDE")], binNames: ["antigravity"], windowHints: ["antigravity", "Antigravity"] },
    { name: "OpenCode", key: "opencode", typeId: "opencode", kind: "opencode", configPath: h(".config", "opencode", "plugins", "winsur.js"), hooksKey: "plugin", detectDirs: [h(".config", "opencode"), h(".local", "share", "opencode"), h(".opencode")], binNames: ["opencode"], windowHints: ["opencode", "OpenCode"] },
    { name: "Qwen Code", key: "qwen", typeId: "qwen-code", kind: "settings", configPath: h(".qwen", "settings.json"), hooksKey: "hooks", detectDirs: [h(".qwen"), h(".qwen-code")], binNames: ["qwen"], windowHints: ["qwen", "Qwen"] },
    { name: "Gemini CLI", key: "gemini", typeId: "gemini", kind: "settings", configPath: h(".gemini", "settings.json"), hooksKey: "hooks", detectDirs: [h(".gemini")], binNames: ["gemini"], windowHints: ["gemini", "Gemini"] },
    { name: "ZCode", key: "zcode", typeId: "zcode", kind: "settings", configPath: h(".zcode", "settings.json"), hooksKey: "hooks", detectDirs: [h(".zcode")], binNames: ["zcode"], windowHints: ["zcode", "ZCode"] },
    { name: "Trae", key: "trae", typeId: "trae", kind: "settings", configPath: a("Trae", "config.json"), hooksKey: "hooks", detectDirs: [a("Trae"), h(".trae")], binNames: ["trae"], windowHints: ["Trae", "trae"] },
    { name: "MiMoCode", key: "mimocode", typeId: "mimocode", kind: "settings", configPath: h(".mimocode", "config.json"), hooksKey: "hooks", detectDirs: [h(".mimocode")], binNames: ["mimocode"], windowHints: ["mimocode", "MiMo"] },
    { name: "Droid", key: "droid", typeId: "droid", kind: "settings", configPath: h(".droid", "config.json"), hooksKey: "hooks", detectDirs: [h(".droid"), h(".factory")], binNames: ["droid"], windowHints: ["droid", "Droid", "Factory"] },
    { name: "Qoder", key: "qoder", typeId: "qoder", kind: "settings", configPath: h(".qoder", "config.json"), hooksKey: "hooks", detectDirs: [h(".qoder")], binNames: ["qoder"], windowHints: ["qoder", "Qoder"] },
    { name: "Kimi Code", key: "kimi", typeId: "kimi", kind: "settings", configPath: h(".kimi", "settings.json"), hooksKey: "hooks", detectDirs: [h(".kimi"), h(".moonshot")], binNames: ["kimi"], windowHints: ["kimi", "Kimi", "Moonshot"] },
    { name: "DeepSeek", key: "deepseek", typeId: "deepseek", kind: "settings", configPath: h(".deepseek", "settings.json"), hooksKey: "hooks", detectDirs: [h(".deepseek")], binNames: ["deepseek"], windowHints: ["deepseek", "DeepSeek"] },
    { name: "Mistral Vibe", key: "mistral", typeId: "mistral", kind: "settings", configPath: h(".mistral", "config.json"), hooksKey: "hooks", detectDirs: [h(".mistral"), h(".vibe")], binNames: ["vibe"], windowHints: ["mistral", "Mistral", "vibe"] },
    { name: "GitHub Copilot", key: "copilot", typeId: "copilot", kind: "settings", configPath: a("GitHub Copilot", "config.json"), hooksKey: "hooks", detectDirs: [a("GitHub Copilot"), h(".copilot")], binNames: ["github-copilot-cli"], windowHints: ["Copilot", "Visual Studio Code"] },
    { name: "CodeBuddy", key: "codebuddy", typeId: "code-buddy", kind: "settings", configPath: h(".codebuddy", "config.json"), hooksKey: "hooks", detectDirs: [h(".codebuddy")], binNames: ["codebuddy"], windowHints: ["codebuddy", "CodeBuddy"] },
    { name: "WorkBuddy", key: "workbuddy", typeId: "workbuddy", kind: "settings", configPath: h(".workbuddy", "config.json"), hooksKey: "hooks", detectDirs: [h(".workbuddy")], binNames: ["workbuddy"], windowHints: ["workbuddy", "WorkBuddy"] },
    { name: "Kiro", key: "kiro", typeId: "kiro", kind: "settings", configPath: h(".kiro", "config.json"), hooksKey: "hooks", detectDirs: [h(".kiro"), a("Kiro")], binNames: ["kiro"], windowHints: ["kiro", "Kiro"] },
    { name: "Hermes", key: "hermes", typeId: "hermes", kind: "hermes", configPath: l("hermes", "plugins", "winsur", "__init__.py"), hooksKey: "hooks", detectDirs: [l("hermes"), h(".hermes"), a("Hermes")], binNames: ["hermes"], windowHints: ["hermes", "Hermes"] },
    { name: "Amp", key: "amp", typeId: "amp", kind: "settings", configPath: h(".amp", "config.json"), hooksKey: "hooks", detectDirs: [h(".amp"), h(".sourcegraph")], binNames: ["amp"], windowHints: ["amp", "Amp", "Sourcegraph"] },
    { name: "Pi Agent", key: "pi", typeId: "pi-agent", kind: "settings", configPath: h(".pi", "config.json"), hooksKey: "hooks", detectDirs: [h(".pi"), h(".pi-agent")], binNames: ["pi"], windowHints: ["pi", "Pi Agent"] },
    { name: "Oh My Pi", key: "oh_my_pi", typeId: "oh-my-pi", kind: "settings", configPath: h(".oh-my-pi", "config.json"), hooksKey: "hooks", detectDirs: [h(".oh-my-pi")], windowHints: ["oh my pi", "Oh My Pi"] },
    { name: "Gajae Code", key: "gajae", typeId: "gajae", kind: "settings", configPath: h(".gajae", "config.json"), hooksKey: "hooks", detectDirs: [h(".gajae")], windowHints: ["gajae", "Gajae"] },
  ];
}

function getTerminalHints() {
  return [
    "Windows Terminal",
    "Terminal",
    "wt",
    "cmd",
    "powershell",
    "pwsh",
    "WezTerm",
    "wezterm",
    "Alacritty",
    "Kitty",
    "Hyper",
    "ConEmu",
    "Cmder",
    "Fluent Terminal",
    "Tabby",
    "VS Code",
    "Code",
    "Cursor",
    "Windsurf",
    "Visual Studio Code",
    "Warp",
    "Ghostty",
  ];
}

module.exports = { getAgentRegistry, getTerminalHints };
