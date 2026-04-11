import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite 配置 - Tauri + React + Tailwind
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri 开发服务器配置
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  // 防止 Vite 遮蔽 Rust 错误
  clearScreen: false,
  // Tauri 环境变量前缀
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri 在 Windows 上使用 Chromium，支持 es2021
    target: "es2021",
    // 调试时不压缩
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
