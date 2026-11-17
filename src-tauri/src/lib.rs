pub mod changes;
pub mod commands;
pub mod diff;
pub mod error;
pub mod git;

use commands::InitialArgs;

/// Register plugins, state and commands on any Tauri runtime (the mock runtime in tests).
pub fn configure<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
    args: InitialArgs,
) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(args)
        .invoke_handler(tauri::generate_handler![
            commands::initial_args,
            commands::open_repo,
            commands::list_changes,
            commands::file_diff,
            commands::file_content,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let args = commands::parse_args(std::env::args().skip(1), &cwd);
    configure(tauri::Builder::default(), args)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
