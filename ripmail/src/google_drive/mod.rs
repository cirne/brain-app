//! Google Drive API and indexing (Brain unified corpus).

mod api;
mod sync;

pub use api::{
    drive_about_user, drive_list_children, drive_list_children_all, drive_search_files,
    normalize_drive_file_row, DriveFileRow, MIME_DOC, MIME_FOLDER, MIME_SHEET,
};
pub use sync::run_google_drive_sync;
