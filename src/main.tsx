// 应用入口 - 挂载 React 到 DOM
import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

function frontendLog(message: string) {
  const text = message.replace(/\s+/g, " ").slice(0, 400);
  void invoke("frontend_log", { message: text }).catch(() => {});
}

window.addEventListener("error", (event) => {
  frontendLog(
    `js-error ${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`
  );
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const text =
    reason instanceof Error ? reason.stack || reason.message : String(reason);
  frontendLog(`unhandledrejection ${text}`);
});

const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  frontendLog(`console.error ${args.map((arg) => String(arg)).join(" ")}`);
  consoleError(...args);
};

function reportLayout(reason: string) {
  const root = document.getElementById("root");
  const pill = root?.firstElementChild;
  const box = pill?.getBoundingClientRect();
  const pillText = box
    ? `${box.x.toFixed(1)},${box.y.toFixed(1)} ${box.width.toFixed(1)}x${box.height.toFixed(1)}`
    : "missing";
  frontendLog(
    `${reason} href=${location.href} html=${document.documentElement.clientWidth}x${document.documentElement.clientHeight} body=${document.body.clientWidth}x${document.body.clientHeight} root=${root?.clientWidth ?? 0}x${root?.clientHeight ?? 0} pill=${pillText}`
  );
}

window.setTimeout(() => reportLayout("ready"), 400);
window.setTimeout(() => reportLayout("ready"), 1600);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
