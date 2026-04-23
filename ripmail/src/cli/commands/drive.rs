//! `ripmail drive` — list and probe Google Drive (uses `google-oauth.json` from a configured mailbox).

use std::collections::HashMap;

use crate::cli::args::DriveCmd;
use crate::cli::util::ripmail_home_path;
use crate::cli::CliResult;
use ripmail::config::read_ripmail_env_file;
use ripmail::google_drive::{
    drive_about_user, drive_list_children, drive_list_children_all, drive_search_files, MIME_FOLDER,
};
use ripmail::oauth::ensure_google_access_token;

pub(crate) fn run_drive(cmd: DriveCmd) -> CliResult {
    let home = ripmail_home_path();
    let env_file = read_ripmail_env_file(&home);
    let process_env: HashMap<String, String> = std::env::vars().collect();

    match cmd {
        DriveCmd::Probe { oauth_source } => {
            let auth =
                ensure_google_access_token(&home, oauth_source.trim(), &env_file, &process_env)
                    .map_err(|e| -> Box<dyn std::error::Error> { format!("OAuth: {e}").into() })?;
            let about = drive_about_user(&auth)?;
            let sample = drive_list_children_all(&auth, "root", 1)?;
            let mime_note =
                "Native Google Docs use mimeType application/vnd.google-apps.document; export as plain text when indexing. Sheets: application/vnd.google-apps.spreadsheet; export CSV.";
            println!(
                "{}",
                serde_json::json!({
                    "ok": true,
                    "about": about,
                    "sampleRootChildren": sample.len(),
                    "firstFiles": sample.into_iter().take(5).collect::<Vec<_>>(),
                    "mimeHints": mime_note,
                })
            );
            Ok(())
        }
        DriveCmd::List {
            oauth_source,
            folder,
            page_token,
            json,
        } => {
            let auth =
                ensure_google_access_token(&home, oauth_source.trim(), &env_file, &process_env)
                    .map_err(|e| -> Box<dyn std::error::Error> { format!("OAuth: {e}").into() })?;
            let folder_id = folder.unwrap_or_else(|| "root".into());
            let (files, next) =
                drive_list_children(&auth, folder_id.trim(), page_token.as_deref())?;
            let rows: Vec<_> = files
                .iter()
                .map(|r| serde_json::to_value(r).unwrap_or_default())
                .collect();
            let out = serde_json::json!({
                "files": rows,
                "nextPageToken": next,
                "folderId": folder_id,
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&out)?);
            } else {
                for f in files {
                    let ty = if f.mime_type == MIME_FOLDER {
                        "folder"
                    } else {
                        "file"
                    };
                    println!("{}  [{}]  {}", ty, f.id, f.name);
                }
                if let Some(t) = next.as_ref() {
                    println!("nextPageToken: {t}");
                }
            }
            Ok(())
        }
        DriveCmd::Search {
            oauth_source,
            q,
            page_token,
            json,
        } => {
            let auth =
                ensure_google_access_token(&home, oauth_source.trim(), &env_file, &process_env)
                    .map_err(|e| -> Box<dyn std::error::Error> { format!("OAuth: {e}").into() })?;
            let (files, next) = drive_search_files(&auth, q.trim(), page_token.as_deref())?;
            let rows: Vec<_> = files
                .iter()
                .map(|r| serde_json::to_value(r).unwrap_or_default())
                .collect();
            let out = serde_json::json!({
                "files": rows,
                "nextPageToken": next,
                "query": q.trim(),
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&out)?);
            } else {
                for f in files {
                    println!("{}  {}", f.id, f.name);
                }
                if let Some(t) = next.as_ref() {
                    println!("nextPageToken: {t}");
                }
            }
            Ok(())
        }
    }
}
