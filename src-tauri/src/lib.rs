// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Desktop shell: one main window with a tab per document, native menus, file
//! associations, the construct library's folder listing, the Sanger alignment commands,
//! feature detection and updates (`updates.rs`).

mod app_data;
mod feedback;
mod usage;
mod updates;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

const APP_NAME: &str = "Strandivo";
const MAIN_LABEL: &str = "main";
const SETTINGS_LABEL: &str = "settings";
const LIBRARY_LABEL: &str = "library";
const ENZYMES_LABEL: &str = "enzymes";

/// Extensions offered in the Open dialog.
const OPEN_EXTENSIONS: &[&str] = &[
    "dna", "gb", "gbk", "gbff", "genbank", "ape", "fa", "fasta", "fas", "fna", "ffn", "faa", "json", "xml", "rdf",
    "sbol", "gff", "gff3", "geneious", "prot", "gp", "genpep", "ab1", "abi", "fastq", "fq", "svcheck",
];

/// Files the construct library lists: constructs, not reads or generic data files.
const LIBRARY_EXTENSIONS: &[&str] = &["dna", "gb", "gbk", "gbff", "genbank", "ape", "fa", "fasta", "fas", "fna", "ffn"];

/// At most this many files are listed from one library folder, at most this deep.
const MAX_LISTED: usize = 5000;
const MAX_DEPTH: usize = 8;

#[derive(Default)]
struct AppState {
    /// Files to open (`None` = a new sequence) while the main window's page isn't listening yet.
    pending: Vec<Option<PathBuf>>,
    /// The main window's page asked for its files, so it now hears "open-files" events.
    main_ready: bool,
    quitting: bool,
}

type Shared = Mutex<AppState>;

/// Absolute, symlink-resolved path, without the `\\?\` prefix Windows adds when
/// canonicalizing (file dialogs and other apps don't understand it).
fn normalize_path(p: PathBuf) -> PathBuf {
    let canonical = p.canonicalize().unwrap_or(p);
    #[cfg(windows)]
    {
        let s = canonical.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if rest.as_bytes().get(1) == Some(&b':') {
                return PathBuf::from(rest.to_string());
            }
        }
    }
    canonical
}

/// Opens files (`None` = a new sequence) as tabs in the main window.
fn open_targets<R: Runtime>(app: &AppHandle<R>, targets: Vec<Option<PathBuf>>) {
    let targets: Vec<Option<PathBuf>> = targets.into_iter().map(|t| t.map(normalize_path)).collect();
    let ready = {
        let state = app.state::<Shared>();
        let mut st = state.lock().unwrap();
        if !st.main_ready {
            st.pending.extend(targets.iter().cloned());
        }
        st.main_ready
    };
    if ready {
        let payload: Vec<Option<String>> = targets
            .iter()
            .map(|t| t.as_ref().map(|p| p.to_string_lossy().into_owned()))
            .collect();
        let _ = app.emit_to(MAIN_LABEL, "open-files", payload);
    }
    show_main_window(app);
}

fn open_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    if !paths.is_empty() {
        open_targets(app, paths.into_iter().map(Some).collect());
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
        .title(APP_NAME)
        .inner_size(1360.0, 880.0)
        .min_inner_size(820.0, 560.0)
        .center();
    #[cfg(target_os = "macos")]
    {
        // The window buttons sit in the app bar at the top, which is also the drag area.
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 20.0));
    }
    if let Err(e) = builder.build() {
        eprintln!("could not open the main window: {e}");
    }
}

fn show_settings_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("index.html".into()))
        .title("Settings")
        .inner_size(700.0, 780.0)
        .min_inner_size(560.0, 480.0)
        .center()
        .build();
}

/// The lab's primer library: one window for the whole app, like Settings.
fn show_library_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(LIBRARY_LABEL) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, LIBRARY_LABEL, WebviewUrl::App("index.html".into()))
        .title("Primer Library")
        .inner_size(900.0, 640.0)
        .min_inner_size(600.0, 400.0)
        .center()
        .build();
}

fn show_enzyme_library_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(ENZYMES_LABEL) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, ENZYMES_LABEL, WebviewUrl::App("index.html".into()))
        .title("Enzyme Library")
        .inner_size(940.0, 640.0)
        .min_inner_size(640.0, 440.0)
        .center()
        .build();
}

fn prompt_open<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.dialog()
        .file()
        .set_title("Open")
        .add_filter("Sequences and traces", OPEN_EXTENSIONS)
        .pick_files(move |picked| {
            let Some(picked) = picked else { return };
            let paths: Vec<PathBuf> = picked.into_iter().filter_map(|p| p.into_path().ok()).collect();
            open_paths(&handle, paths);
        });
}

/// ⌘W: closes the current tab in the main window, and Settings or a library window
/// themselves.
fn close_focused<R: Runtime>(app: &AppHandle<R>) {
    for (label, w) in app.webview_windows() {
        if w.is_focused().unwrap_or(false) {
            if label == MAIN_LABEL {
                let _ = app.emit_to(MAIN_LABEL, "menu", "close".to_string());
            } else {
                let _ = w.close();
            }
            return;
        }
    }
}

fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    let windows = app.webview_windows();
    if windows.is_empty() {
        finish_quit(app);
        return;
    }
    {
        let state = app.state::<Shared>();
        state.lock().unwrap().quitting = true;
    }
    // The main window asks about unsaved changes in its tabs before it closes.
    for (_, w) in windows {
        let _ = w.close();
    }
}

/// Every window has closed on the way out: exit, or install the update the user chose to
/// restart for. If that fails, the app stays open and the main window says why.
fn finish_quit<R: Runtime>(app: &AppHandle<R>) {
    if updates::finish_quit(app) {
        app.exit(0);
        return;
    }
    app.state::<Shared>().lock().unwrap().quitting = false;
    show_main_window(app);
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let new = MenuItemBuilder::with_id("new", "New Sequence").accelerator("CmdOrCtrl+N").build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open…").accelerator("CmdOrCtrl+O").build(app)?;
    let close = MenuItemBuilder::with_id("close", "Close Tab").accelerator("CmdOrCtrl+W").build(app)?;
    let home = MenuItemBuilder::with_id("home", "Home: Constructs")
        .accelerator("CmdOrCtrl+Shift+H")
        .build(app)?;
    let save = MenuItemBuilder::with_id("save", "Save").accelerator("CmdOrCtrl+S").build(app)?;
    let save_as = MenuItemBuilder::with_id("save-as", "Save As…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let export_gb = MenuItemBuilder::with_id("export-genbank", "Export GenBank…").build(app)?;
    let export_fa = MenuItemBuilder::with_id("export-fasta", "Export FASTA…").build(app)?;
    let add_reads = MenuItemBuilder::with_id("add-reads", "Align Sequencing Reads…")
        .accelerator("CmdOrCtrl+Shift+R")
        .build(app)?;
    let show_map = MenuItemBuilder::with_id("show-map", "Map").accelerator("CmdOrCtrl+1").build(app)?;
    let show_sequence = MenuItemBuilder::with_id("show-sequence", "Sequence")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let show_primers = MenuItemBuilder::with_id("show-primers", "Primers")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    let show_reads = MenuItemBuilder::with_id("show-reads", "Sequencing Reads")
        .accelerator("CmdOrCtrl+4")
        .build(app)?;
    let show_info = MenuItemBuilder::with_id("show-info", "Plasmid Info")
        .accelerator("CmdOrCtrl+5")
        .build(app)?;
    let split_view = MenuItemBuilder::with_id("split-view", "Map and Sequence Side by Side").build(app)?;
    let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", "Show or Hide Sidebar").build(app)?;
    let toggle_inspector = MenuItemBuilder::with_id("toggle-inspector", "Show or Hide Inspector").build(app)?;
    // Undo, Redo and Select All act on the document (its own undo history and sequence
    // selection), so they're ordinary items handled by the page, not the system's.
    let undo = MenuItemBuilder::with_id("undo", "Undo").accelerator("CmdOrCtrl+Z").build(app)?;
    let redo = MenuItemBuilder::with_id("redo", "Redo")
        .accelerator(if cfg!(target_os = "macos") { "CmdOrCtrl+Shift+Z" } else { "CmdOrCtrl+Y" })
        .build(app)?;
    let select_all = MenuItemBuilder::with_id("select-all", "Select All")
        .accelerator("CmdOrCtrl+A")
        .build(app)?;
    let find = MenuItemBuilder::with_id("find", "Find…").accelerator("CmdOrCtrl+F").build(app)?;
    let reverse_complement = MenuItemBuilder::with_id("reverse-complement", "Reverse Complement").build(app)?;
    let set_origin = MenuItemBuilder::with_id("set-origin", "Set Origin at Cursor").build(app)?;
    let add_feature = MenuItemBuilder::with_id("add-feature", "Add Feature from Selection").build(app)?;
    let add_primer = MenuItemBuilder::with_id("add-primer", "Add Primer from Selection").build(app)?;
    let detect_features_item = MenuItemBuilder::with_id("detect-features", "Detect Features…").build(app)?;
    let digest = MenuItemBuilder::with_id("digest", "Digest…").build(app)?;
    let simulate_cloning = MenuItemBuilder::with_id("simulate-cloning", "Simulate Cloning…").build(app)?;
    let library = MenuItemBuilder::with_id("library", "Primer Library")
        .accelerator("CmdOrCtrl+Shift+L")
        .build(app)?;
    let enzyme_library = MenuItemBuilder::with_id("enzyme-library", "Enzyme Library").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let check_updates = MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(app)?;
    let welcome = MenuItemBuilder::with_id("welcome", "Welcome to Strandivo…").build(app)?;
    let send_feedback = MenuItemBuilder::with_id("feedback", "Send Feedback…").build(app)?;
    let report_bug = MenuItemBuilder::with_id("report-bug", "Report a Bug…").build(app)?;
    let website = MenuItemBuilder::with_id("website", "Strandivo Website").build(app)?;
    let github = MenuItemBuilder::with_id("github", "Strandivo on GitHub").build(app)?;

    let about = AboutMetadata {
        name: Some(APP_NAME.to_string()),
        version: Some(app.package_info().version.to_string()),
        license: Some("GPL-3.0-or-later".to_string()),
        comments: Some("Plan, build and check your plasmids.".to_string()),
        website: Some("https://strandivo.com".to_string()),
        website_label: Some("strandivo.com".to_string()),
        ..Default::default()
    };

    let mut file = SubmenuBuilder::new(app, "File")
        .item(&new)
        .item(&open)
        .separator()
        .item(&save)
        .item(&save_as)
        .item(&export_gb)
        .item(&export_fa)
        .separator()
        .item(&close);
    if !cfg!(target_os = "macos") {
        let quit = MenuItemBuilder::with_id("quit", "Exit").build(app)?;
        file = file.separator().item(&settings).separator().item(&quit);
    }
    let file = file.build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .cut()
        .copy()
        .paste()
        .item(&select_all)
        .separator()
        .item(&find)
        .separator()
        .item(&reverse_complement)
        .item(&set_origin)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&show_map)
        .item(&show_sequence)
        .item(&show_primers)
        .item(&show_reads)
        .item(&show_info)
        .separator()
        .item(&split_view)
        .item(&toggle_sidebar)
        .item(&toggle_inspector)
        .build()?;
    let tools = SubmenuBuilder::new(app, "Tools")
        .item(&add_feature)
        .item(&add_primer)
        .item(&detect_features_item)
        .separator()
        .item(&digest)
        .item(&simulate_cloning)
        .item(&add_reads)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&home)
        .item(&library)
        .item(&enzyme_library)
        .separator()
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;

    let mut menu = MenuBuilder::new(app);
    if cfg!(target_os = "macos") {
        let quit = MenuItemBuilder::with_id("quit", format!("Quit {APP_NAME}"))
            .accelerator("CmdOrCtrl+Q")
            .build(app)?;
        let app_menu = SubmenuBuilder::new(app, APP_NAME)
            .about(Some(about))
            .item(&check_updates)
            .item(&welcome)
            .separator()
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .item(&quit)
            .build()?;
        menu = menu.item(&app_menu);
        // On a Mac, Welcome and Check for Updates stay in the app's own menu, where 0.2.0
        // put them and its notes say they are.
        let help = SubmenuBuilder::new(app, "Help")
            .item(&send_feedback)
            .item(&report_bug)
            .separator()
            .item(&website)
            .item(&github)
            .build()?;
        return menu.item(&file).item(&edit).item(&view).item(&tools).item(&window).item(&help).build();
    }
    let help = SubmenuBuilder::new(app, "Help")
        .item(&send_feedback)
        .item(&report_bug)
        .separator()
        .item(&welcome)
        .item(&check_updates)
        .separator()
        .item(&website)
        .item(&github)
        .separator()
        .about(Some(about))
        .build()?;
    menu.item(&file).item(&edit).item(&view).item(&tools).item(&window).item(&help).build()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowInfo {
    kind: &'static str,
    /// For the main window: files to open as tabs (`None` = a new sequence).
    paths: Vec<Option<String>>,
}

#[tauri::command]
fn window_info(window: tauri::Window, state: tauri::State<'_, Shared>) -> WindowInfo {
    match window.label() {
        SETTINGS_LABEL => WindowInfo { kind: "settings", paths: vec![] },
        LIBRARY_LABEL => WindowInfo { kind: "library", paths: vec![] },
        ENZYMES_LABEL => WindowInfo { kind: "enzymes", paths: vec![] },
        _ => {
            // The page listens for "open-files" before asking, so later files go to it directly.
            let mut st = state.lock().unwrap();
            st.main_ready = true;
            let paths = st
                .pending
                .drain(..)
                .map(|p| p.map(|p| p.to_string_lossy().into_owned()))
                .collect();
            WindowInfo { kind: "main", paths }
        }
    }
}

#[derive(Serialize)]
struct ListedFile {
    path: String,
    size: u64,
    /// Milliseconds since 1970.
    modified: f64,
}

fn collect_sequence_files(dir: &Path, depth: usize, out: &mut Vec<ListedFile>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= MAX_LISTED {
            return;
        }
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        // Not followed through symbolic links, so a link back up can't loop.
        let Ok(meta) = entry.metadata() else { continue };
        let path = entry.path();
        if meta.is_dir() {
            collect_sequence_files(&path, depth + 1, out);
        } else if meta.is_file() {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if LIBRARY_EXTENSIONS.contains(&ext.as_str()) {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0);
                out.push(ListedFile { path: path.to_string_lossy().into_owned(), size: meta.len(), modified });
            }
        }
    }
}

/// Sequence files in a library folder and its subfolders.
#[tauri::command]
async fn list_sequence_files(folder: String) -> Result<Vec<ListedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&folder);
        if !root.is_dir() {
            return Err(format!("{folder} is not a folder (moved or renamed?)"));
        }
        let mut out = Vec::new();
        collect_sequence_files(&root, 0, &mut out);
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    })
    .await
    .map_err(|e| format!("Could not list the folder: {e}"))?
}

// Commands that may create windows are async: creating a window from a synchronous
// command can deadlock on Windows.
#[tauri::command]
async fn open_files(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    open_paths(&app, paths.into_iter().map(PathBuf::from).collect());
    Ok(())
}

#[tauri::command]
async fn new_document(app: AppHandle) -> Result<(), String> {
    open_targets(&app, vec![None]);
    Ok(())
}

#[tauri::command]
async fn show_open_dialog(app: AppHandle) -> Result<(), String> {
    prompt_open(&app);
    Ok(())
}

#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings_window(&app);
    Ok(())
}

#[tauri::command]
async fn open_library(app: AppHandle) -> Result<(), String> {
    show_library_window(&app);
    Ok(())
}

#[tauri::command]
async fn open_enzyme_library(app: AppHandle) -> Result<(), String> {
    show_enzyme_library_window(&app);
    Ok(())
}

#[tauri::command]
fn cancel_quit(app: AppHandle, state: tauri::State<'_, Shared>) {
    state.lock().unwrap().quitting = false;
    updates::quit_cancelled(&app);
}

#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Could not read {path}: {e}"))
}

/// Writes via a temporary file so a crash mid-save never leaves a half-written file.
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let tmp = target.with_file_name(format!(".{file_name}.saving"));
    std::fs::write(&tmp, contents.as_bytes()).map_err(|e| format!("Could not write {path}: {e}"))?;
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save {path}: {e}")
    })
}

#[tauri::command]
async fn align_reads(request: seqcore_json::AlignRequest) -> Result<seqcore_json::AlignResponse, String> {
    tauri::async_runtime::spawn_blocking(move || seqcore_json::align(request))
        .await
        .map_err(|e| format!("Alignment failed: {e}"))
}

#[tauri::command]
fn catalog_version() -> &'static str {
    seqcore_json::catalog_version()
}

#[tauri::command]
async fn detect_features(
    request: seqcore_json::DetectRequest,
) -> Result<seqcore_json::DetectResponse, String> {
    tauri::async_runtime::spawn_blocking(move || seqcore_json::detect(request))
        .await
        .map_err(|e| format!("Feature detection failed: {e}"))
}

fn files_from_args(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .collect()
}

/// Installs the TLS provider every HTTPS client uses, before anything can make one: reqwest
/// is built without one and panics building a client otherwise, and release builds abort on
/// a panic. The updater installs the same one, but only once it checks, so 0.3.0 crashed
/// when statistics were sent first. Installing it again does nothing.
pub(crate) fn install_tls_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // Fails only if another thread installed one first, which is just as good.
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_tls_provider();
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // A second launch (e.g. double-clicking another file on Windows) hands its files
        // to the running app instead of starting a new one.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let files = files_from_args(argv.into_iter().skip(1));
            if files.is_empty() {
                show_main_window(app);
            } else {
                open_paths(app, files);
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(AppState::default()))
        .manage(updates::SharedUpdates::default())
        .manage(usage::SharedUsage::default())
        .invoke_handler(tauri::generate_handler![
            window_info,
            list_sequence_files,
            open_files,
            new_document,
            show_open_dialog,
            open_settings,
            open_library,
            open_enzyme_library,
            app_data::load_app_data,
            app_data::save_app_data,
            app_data::set_aside_app_data,
            cancel_quit,
            read_file,
            write_file,
            align_reads,
            detect_features,
            catalog_version,
            updates::check_update,
            updates::download_update,
            updates::restart_to_update,
            updates::open_whats_new,
            updates::take_update_failure,
            feedback::system_info,
            feedback::open_issue,
            feedback::email_feedback,
            feedback::open_project_page,
            usage::send_usage
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let menu = build_menu(&handle)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let id: &str = event.id().as_ref();
                match id {
                    "new" => open_targets(app, vec![None]),
                    "open" => prompt_open(app),
                    "settings" => show_settings_window(app),
                    "library" => show_library_window(app),
                    "enzyme-library" => show_enzyme_library_window(app),
                    "quit" => request_quit(app),
                    "close" => close_focused(app),
                    "website" | "github" => feedback::open_page(app, id),
                    "home" | "check-updates" | "welcome" | "feedback" | "report-bug" => {
                        show_main_window(app);
                        let _ = app.emit_to(MAIN_LABEL, "menu", id.to_string());
                    }
                    // Everything else is for the main window's current tab.
                    other => {
                        let _ = app.emit_to(MAIN_LABEL, "menu", other.to_string());
                    }
                }
            });

            // Files passed on the command line (Windows/Linux "Open with").
            let files = files_from_args(std::env::args().skip(1));
            if !files.is_empty() {
                open_paths(&handle, files);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let label = window.label().to_string();
            if let WindowEvent::Destroyed = event {
                let quitting = {
                    let state = app.state::<Shared>();
                    let mut st = state.lock().unwrap();
                    if label == MAIN_LABEL {
                        st.main_ready = false;
                    }
                    st.quitting
                };
                let others = app.webview_windows().keys().filter(|l| **l != label).count();
                if quitting && others == 0 {
                    finish_quit(app);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|app, event| match event {
        RunEvent::Ready => {
            // Give macOS a moment to deliver files the app was launched with; if none
            // arrive, show the main window on Home.
            let handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(350));
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    if h.webview_windows().is_empty() {
                        show_main_window(&h);
                    }
                });
            });
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let files: Vec<PathBuf> = urls.into_iter().filter_map(|u| u.to_file_path().ok()).collect();
            open_paths(app, files);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows, .. } => {
            if !has_visible_windows {
                show_main_window(app);
            }
        }
        RunEvent::ExitRequested { code, api, .. } => {
            // On macOS, closing the last window keeps the app running (like other Mac apps);
            // File > New/Open still work from the menu bar.
            let quitting = app.state::<Shared>().lock().unwrap().quitting;
            if code.is_none() && cfg!(target_os = "macos") && !quitting {
                api.prevent_exit();
            }
        }
        _ => {}
    });
}
