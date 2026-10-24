//! Release builds use the Windows subsystem, so stderr never reaches the user.
//! Startup, panics, and window geometry go to `%APPDATA%\Winsur\winsur.log`.

use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn init() {
    let path = log_path();
    if let Some(dir) = path.parent() {
        let _ = create_dir_all(dir);
    }
    let path_for_hook = path.clone();
    std::panic::set_hook(Box::new(move |info| {
        append(&path_for_hook, &format!("PANIC: {info}"));
        eprintln!("PANIC: {info}");
    }));
    write("---- winsur start ----");
    write(&format!("log={}", path.display()));
    write(&format!("pid={}", std::process::id()));
    if let Ok(exe) = std::env::current_exe() {
        write(&format!("exe={}", exe.display()));
    }
    let args: Vec<String> = std::env::args().collect();
    write(&format!("args={}", args.join(" ")));
    if smoke_requested() {
        write("smoke-test=1");
    }
    #[cfg(dev)]
    write("frontend=dev-url");
    #[cfg(not(dev))]
    write("frontend=embedded");
}

pub fn smoke_requested() -> bool {
    std::env::args().any(|arg| arg == "--smoke-test")
}

pub fn write(message: &str) {
    let path = log_path();
    append(&path, message);
    eprintln!("{message}");
}

pub fn log_path() -> PathBuf {
    if let Some(appdata) = std::env::var_os("APPDATA") {
        return PathBuf::from(appdata).join("Winsur").join("winsur.log");
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".winsur").join("winsur.log")
}

fn append(path: &std::path::Path, message: &str) {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Some(dir) = path.parent() {
        let _ = create_dir_all(dir);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{stamp}] {message}");
        let _ = file.flush();
    }
}
