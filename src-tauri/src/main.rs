#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    winsur_lib::init_logging();
    winsur_lib::run();
}
