// Winsur — multi-agent control surface

import { IslandContainer } from "./components/Island/IslandContainer";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import "./styles/globals.css";

function App() {
  // 监听 Tauri 后端 Agent 事件
  useAgentEvents();
  // 全局键盘快捷键 (Enter=Allow, Esc=Deny)
  useKeyboardShortcuts();

  return <IslandContainer />;
}

export default App
