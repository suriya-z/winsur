//! Pure Winsur logic shared by the Tauri shell. No Win32 and no webview.

pub mod agent;
pub mod discover;
pub mod focus;
pub mod hit_region;
pub mod hooks;
pub mod registry;
pub mod server;
pub mod settings;
pub mod ssh;
pub mod usage;

pub use agent::SessionManager;
pub use server::HookServer;
