// Vibe Island Win - 桌面应用入口
// 防止 Windows 上出现控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vibe_island_win_lib::run()
}
