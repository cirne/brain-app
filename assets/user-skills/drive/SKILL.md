---
name: drive
label: "Google Drive: pick folders to add to your search index"
description: >-
  Help the user connect Google Drive folders to Brain’s unified search index using the same OAuth as Gmail.
  Use **google_drive_list** and **google_drive_search** to explore Drive; use **manage_sources** op=add with
  **oauth_source_id** (Gmail mailbox source id) and **drive_folder_id** (Drive folder id, or `root`) to register
  indexing; then **refresh_sources** or wait for background sync. Native Google Docs and Sheets are exported to text/CSV for indexing.
hint: which Drive folder or search you care about — say it plainly
args: >-
  Optional: folder name, “My Drive root”, or a Drive search query.
---

# Google Drive (indexed cloud folders)

Use this skill when the user wants **Drive content in Brain’s search corpus**, mirroring the local “add folders” flow.

## Tools

- **`google_drive_list`** — list children of a folder (`oauth_source` = ripmail mailbox id with `google-oauth.json`; `folder` = Drive id or omit/`root`).
- **`google_drive_search`** — Drive metadata search (`q` uses [Google’s query syntax](https://developers.google.com/drive/api/guides/search-files)).
- **`manage_sources`** — `op=add` with **`oauth_source_id`** + **`drive_folder_id`** (not `path`) to register a **`googleDrive`** source.
- **`refresh_sources`** — sync/index after adding a source.

## Defaults

Assume the Gmail-linked mailbox id from **`manage_sources` op=list** when the user says “my Gmail” — pass that source id as **`oauth_source`** / **`oauth_source_id`**.

## Confirmation

Do not call **`manage_sources` add** until the user confirms which folder(s) to index (numbered list pattern).
