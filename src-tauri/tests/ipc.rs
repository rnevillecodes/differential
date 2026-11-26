//! Exercises the registered Tauri commands through the IPC layer (mock runtime),
//! the same path the frontend's `invoke` calls take.

mod common;

use common::TestRepo;
use differential_lib::commands::InitialArgs;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

fn app(args: InitialArgs) -> (tauri::App<tauri::test::MockRuntime>, WebviewWindow<tauri::test::MockRuntime>) {
    let app = differential_lib::configure(mock_builder(), args)
        .build(mock_context(noop_assets()))
        .expect("build app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build webview");
    (app, webview)
}

fn invoke(webview: &WebviewWindow<tauri::test::MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    let url = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: url.parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| b.deserialize::<Value>().unwrap())
}

#[test]
fn commands_round_trip_through_ipc() {
    let repo = TestRepo::with_files(&[("a.txt", "one\ntwo\n")]);
    repo.write("a.txt", "one\nTWO\n");
    repo.write("new.txt", "fresh\n");
    let (_app, w) = app(InitialArgs { path: Some("C:/x".into()), base: Some("main".into()), wait: true });

    // `wait` is backend-only and never reaches the webview.
    let args = invoke(&w, "initial_args", json!({})).unwrap();
    assert_eq!(args, json!({ "path": "C:/x", "base": "main" }));

    let info = invoke(&w, "open_repo", json!({ "path": repo.path() })).unwrap();
    let root = info["root"].as_str().unwrap().to_string();
    assert!(info["headSha"].is_string());

    let cs = invoke(&w, "list_changes", json!({ "root": root, "base": "" })).unwrap();
    assert_eq!(cs["totals"]["files"], 2);
    let base_sha = cs["baseSha"].as_str().unwrap();
    let file = cs["files"].as_array().unwrap().iter().find(|f| f["newPath"] == "a.txt").unwrap();

    let diff = invoke(
        &w,
        "file_diff",
        json!({ "root": root, "baseSha": base_sha, "file": file, "force": false }),
    )
    .unwrap();
    assert_eq!(diff["hunks"][0]["lines"][1]["kind"], "removed");

    let content = invoke(
        &w,
        "file_content",
        json!({ "root": root, "baseSha": base_sha, "path": "a.txt", "side": "base" }),
    )
    .unwrap();
    assert_eq!(content, json!("one\ntwo\n"));
}

#[test]
fn errors_arrive_as_kind_and_message() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, w) = app(InitialArgs::default());
    let err = invoke(&w, "open_repo", json!({ "path": dir.path() })).unwrap_err();
    assert_eq!(err["kind"], "notARepo");
    assert!(err["message"].as_str().unwrap().contains("not inside a git repository"));
}

#[test]
fn file_browsing_commands_round_trip_through_ipc() {
    let repo = TestRepo::with_files(&[("src/a.ts", "let a = 1;\n")]);
    repo.write("new.txt", "fresh\n");
    let (_app, w) = app(InitialArgs::default());
    let root = repo.path().to_string_lossy().to_string();

    let mut files: Vec<String> =
        serde_json::from_value(invoke(&w, "list_files", json!({ "root": root })).unwrap()).unwrap();
    files.sort();
    assert_eq!(files, vec!["new.txt", "src/a.ts"]);

    let view = invoke(&w, "view_file", json!({ "root": root, "path": "src/a.ts", "force": false })).unwrap();
    assert_eq!(view, json!({ "kind": "text", "content": "let a = 1;\n" }));

    let missing = invoke(&w, "view_file", json!({ "root": root, "path": "gone.ts", "force": false })).unwrap();
    assert_eq!(missing, json!({ "kind": "missing" }));

    let err = invoke(&w, "view_file", json!({ "root": root, "path": "../x", "force": false })).unwrap_err();
    assert_eq!(err["kind"], "invalid");
}

#[test]
fn read_image_returns_raw_bytes_through_ipc() {
    let repo = TestRepo::new();
    repo.write_bytes("a.png", &[0x89, b'P', b'N', b'G', 0, 1, 2, 255]);
    let (_app, w) = app(InitialArgs::default());
    let root = repo.path().to_string_lossy().to_string();
    let url = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };
    let request = |path: &str| InvokeRequest {
        cmd: "read_image".into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: url.parse().unwrap(),
        body: InvokeBody::Json(json!({ "root": root, "path": path })),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    match get_ipc_response(&w, request("a.png")).unwrap() {
        tauri::ipc::InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, vec![0x89, b'P', b'N', b'G', 0, 1, 2, 255]),
        other => panic!("expected raw bytes, got {other:?}"),
    }
    let err = get_ipc_response(&w, request("src.ts")).unwrap_err();
    assert_eq!(err["kind"], "invalid");
}

#[test]
fn list_refs_round_trips_through_ipc() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    repo.git(&["tag", "v1.0"]);
    let (_app, w) = app(InitialArgs::default());
    let root = repo.path().to_string_lossy().to_string();

    let refs = invoke(&w, "list_refs", json!({ "root": root })).unwrap();
    let refs = refs.as_array().unwrap();
    assert!(refs.contains(&json!({ "name": "main", "rev": "main", "kind": "local", "current": true })));
    assert!(refs.contains(&json!({ "name": "v1.0", "rev": "v1.0", "kind": "tag", "current": false })));
}

#[test]
fn list_commits_round_trips_through_ipc() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    let (_app, w) = app(InitialArgs::default());
    let root = repo.path().to_string_lossy().to_string();

    let page = invoke(&w, "list_commits", json!({ "root": root, "offset": 0, "limit": 500 })).unwrap();
    assert_eq!(page["hasMore"], false);
    let commit = &page["commits"][0];
    assert_eq!(commit["subject"], "initial");
    assert_eq!(commit["head"], true);
    assert!(commit["shortSha"].is_string());
    assert_eq!(commit["labels"], json!([{ "name": "main", "rev": "main", "kind": "local" }]));
}

#[test]
fn list_commits_outside_a_repository_is_an_error_payload() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, w) = app(InitialArgs::default());
    let err = invoke(&w, "list_commits", json!({ "root": dir.path(), "offset": 0, "limit": 500 })).unwrap_err();
    assert_eq!(err["kind"], "notARepo");
}

#[test]
fn terminal_commands_ignore_unknown_sessions() {
    let (_app, w) = app(InitialArgs::default());
    assert_eq!(invoke(&w, "terminal_write", json!({ "id": 4242, "data": "ls\r" })).unwrap(), Value::Null);
    assert_eq!(invoke(&w, "terminal_resize", json!({ "id": 4242, "cols": 80, "rows": 24 })).unwrap(), Value::Null);
    assert_eq!(invoke(&w, "terminal_close", json!({ "id": 4242 })).unwrap(), Value::Null);
}

#[test]
fn terminal_spawn_with_missing_directory_is_an_error_payload() {
    let (_app, w) = app(InitialArgs::default());
    let missing = tempfile::tempdir().unwrap().path().join("gone");
    let err = invoke(
        &w,
        "terminal_spawn",
        json!({
            "cwd": missing,
            "cols": 80,
            "rows": 24,
            "onData": "__CHANNEL__:7",
            "onExit": "__CHANNEL__:8",
        }),
    )
    .unwrap_err();
    assert_eq!(err["kind"], "io");
    assert!(err["message"].as_str().unwrap().contains("not a directory"), "{err}");
}

#[test]
fn watch_repo_replaces_the_current_watch_and_ignores_stale_unwatch() {
    use differential_lib::watch::WatchersState;
    use tauri::Manager;
    let a = TestRepo::with_files(&[("a.txt", "a\n")]);
    let b = TestRepo::with_files(&[("b.txt", "b\n")]);
    let (app, w) = app(InitialArgs::default());
    let watchers = app.state::<WatchersState>().inner().clone();

    let id_a = invoke(&w, "watch_repo", json!({ "root": a.path(), "onEvent": "__CHANNEL__:21" })).unwrap();
    assert_eq!(watchers.current_id(), id_a.as_u64().map(|v| v as u32));
    let id_b = invoke(&w, "watch_repo", json!({ "root": b.path(), "onEvent": "__CHANNEL__:22" })).unwrap();
    assert_ne!(id_a, id_b);
    assert_eq!(watchers.current_id(), id_b.as_u64().map(|v| v as u32));

    // A stale id leaves the new watch running; the current id stops it.
    assert_eq!(invoke(&w, "unwatch_repo", json!({ "id": id_a })).unwrap(), Value::Null);
    assert_eq!(watchers.current_id(), id_b.as_u64().map(|v| v as u32));
    assert_eq!(invoke(&w, "unwatch_repo", json!({ "id": id_b })).unwrap(), Value::Null);
    assert_eq!(watchers.current_id(), None);
}

#[test]
fn watch_repo_outside_a_repository_is_an_error_payload() {
    let (_app, w) = app(InitialArgs::default());
    let dir = tempfile::tempdir().unwrap();
    let err = invoke(&w, "watch_repo", json!({ "root": dir.path(), "onEvent": "__CHANNEL__:23" })).unwrap_err();
    assert_eq!(err["kind"], "notARepo", "{err}");
}
