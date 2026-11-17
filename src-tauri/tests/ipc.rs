//! Exercises the registered Tauri commands through the IPC layer (mock runtime),
//! the same path the frontend's `invoke` calls take.

mod common;

use common::TestRepo;
use mydiff_lib::commands::InitialArgs;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

fn app(args: InitialArgs) -> (tauri::App<tauri::test::MockRuntime>, WebviewWindow<tauri::test::MockRuntime>) {
    let app = mydiff_lib::configure(mock_builder(), args)
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
    let (_app, w) = app(InitialArgs { path: Some("C:/x".into()), base: Some("main".into()) });

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
