pub mod changes;
pub mod commands;
pub mod content;
pub mod diff;
pub mod error;
pub mod files;
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
            commands::list_files,
            commands::view_file,
            commands::list_refs,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let args = commands::parse_args(std::env::args().skip(1), &cwd);
    configure(tauri::Builder::default(), args)
        .setup(|app| {
            // Set the window icon from an embedded image so a changed icon always
            // triggers a rebuild (the bundle icons alone can be served from a stale build).
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))?;
                window.set_icon(icon)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
