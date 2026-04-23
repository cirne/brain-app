//! Google Drive API v3 helpers (OAuth bearer from RipMail [`crate::oauth::ensure_google_access_token`]).
//
// Uses `drive.readonly` scope. Native Google Docs/Sheets require **export**, not `alt=media`.

use serde::Deserialize;
use serde_json::Value;

/// One row suitable for agents and JSON tooling.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFileRow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub parents: Vec<String>,
    #[serde(default)]
    pub modified_time: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub web_view_link: Option<String>,
}

pub const MIME_FOLDER: &str = "application/vnd.google-apps.folder";
pub const MIME_DOC: &str = "application/vnd.google-apps.document";
pub const MIME_SHEET: &str = "application/vnd.google-apps.spreadsheet";

pub fn normalize_drive_file_row(v: &Value) -> Option<DriveFileRow> {
    let id = v.get("id")?.as_str()?.to_string();
    let name = v
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let mime_type = v
        .get("mimeType")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let parents = v
        .get("parents")
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let modified_time = v
        .get("modifiedTime")
        .and_then(|x| x.as_str())
        .map(String::from);
    let size = v.get("size").and_then(|x| x.as_str()).map(String::from);
    let web_view_link = v
        .get("webViewLink")
        .and_then(|x| x.as_str())
        .map(String::from);
    Some(DriveFileRow {
        id,
        name,
        mime_type,
        parents,
        modified_time,
        size,
        web_view_link,
    })
}

fn fetch_json_expect_ok(auth: &str, url: &str) -> Result<Value, Box<dyn std::error::Error>> {
    let resp = ureq::get(url)
        .set("Authorization", &format!("Bearer {auth}"))
        .call()?;
    let status = resp.status();
    let body = resp.into_string().unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(format!("Google Drive API HTTP {status}: {body}").into());
    }
    Ok(serde_json::from_str(&body)?)
}

/// `GET drive/v3/about` — proves token can call Drive.
pub fn drive_about_user(auth: &str) -> Result<Value, Box<dyn std::error::Error>> {
    let url = "https://www.googleapis.com/drive/v3/about?fields=user/emailAddress,user/displayName";
    fetch_json_expect_ok(auth, url)
}

/// Children of `folder_id` (`'root'` allowed). Handles pagination.
pub fn drive_list_children(
    auth: &str,
    folder_id: &str,
    page_token: Option<&str>,
) -> Result<(Vec<DriveFileRow>, Option<String>), Box<dyn std::error::Error>> {
    let escaped = folder_id.replace('\'', "\\'");
    let q = format!("'{escaped}' in parents and trashed = false");
    let mut url = format!(
        "https://www.googleapis.com/drive/v3/files?pageSize=50&q={}&fields=files(id%2Cname%2CmimeType%2Cparents%2CmodifiedTime%2Csize%2CwebViewLink)%2CnextPageToken&supportsAllDrives=true&includeItemsFromAllDrives=true",
        urlencoding::encode(&q)
    );
    if let Some(tok) = page_token.filter(|s| !s.is_empty()) {
        url.push_str("&pageToken=");
        url.push_str(&urlencoding::encode(tok));
    }
    let v = fetch_json_expect_ok(auth, &url)?;
    let mut files = Vec::new();
    if let Some(arr) = v.get("files").and_then(|f| f.as_array()) {
        for item in arr {
            if let Some(row) = normalize_drive_file_row(item) {
                files.push(row);
            }
        }
    }
    let next = v
        .get("nextPageToken")
        .and_then(|x| x.as_str())
        .map(String::from);
    Ok((files, next))
}

/// Same as [`drive_list_children`] but merges all pages (for CLI list / probe).
pub fn drive_list_children_all(
    auth: &str,
    folder_id: &str,
    max_pages: usize,
) -> Result<Vec<DriveFileRow>, Box<dyn std::error::Error>> {
    let mut out = Vec::new();
    let mut tok: Option<String> = None;
    for _ in 0..max_pages {
        let (page, next) = drive_list_children(auth, folder_id, tok.as_deref())?;
        out.extend(page);
        match next {
            Some(n) if !n.is_empty() => tok = Some(n),
            _ => break,
        }
    }
    Ok(out)
}

/// Full-text search across Drive ([Drive search query syntax](https://developers.google.com/drive/api/guides/search-files)).
pub fn drive_search_files(
    auth: &str,
    q: &str,
    page_token: Option<&str>,
) -> Result<(Vec<DriveFileRow>, Option<String>), Box<dyn std::error::Error>> {
    let mut url = format!(
        "https://www.googleapis.com/drive/v3/files?pageSize=25&q={}&fields=files(id%2Cname%2CmimeType%2Cparents%2CmodifiedTime%2Csize%2CwebViewLink)%2CnextPageToken&supportsAllDrives=true&includeItemsFromAllDrives=true",
        urlencoding::encode(q)
    );
    if let Some(tok) = page_token.filter(|s| !s.is_empty()) {
        url.push_str("&pageToken=");
        url.push_str(&urlencoding::encode(tok));
    }
    let v = fetch_json_expect_ok(auth, &url)?;
    let mut files = Vec::new();
    if let Some(arr) = v.get("files").and_then(|f| f.as_array()) {
        for item in arr {
            if let Some(row) = normalize_drive_file_row(item) {
                files.push(row);
            }
        }
    }
    let next = v
        .get("nextPageToken")
        .and_then(|x| x.as_str())
        .map(String::from);
    Ok((files, next))
}

/// Download raw bytes (`alt=media`). Not valid for native Docs/Sheets.
pub fn drive_download_media(
    auth: &str,
    file_id: &str,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&supportsAllDrives=true",
    );
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {auth}"))
        .call()?;
    let status = resp.status();
    let body = resp.into_string().unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(format!("Drive download HTTP {status}: {body}").into());
    }
    Ok(body.into_bytes())
}

/// Export Google Docs / Sheets to plain text or CSV bytes.
pub fn drive_export(
    auth: &str,
    file_id: &str,
    export_mime: &str,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}/export?mimeType={}&supportsAllDrives=true",
        file_id,
        urlencoding::encode(export_mime)
    );
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {auth}"))
        .call()?;
    let status = resp.status();
    let body = resp.into_string().unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(format!("Drive export HTTP {status}: {body}").into());
    }
    Ok(body.into_bytes())
}
