use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::time::interval;

use crate::bridge::contacts::enrich_handle_from_contacts;
use crate::bridge::cursor::{advance_imessage_cursor, imessage_last_rowid};
use crate::bridge::edits_window::fetch_recent_window;
use crate::bridge::imessage::{fetch_since, ImessageRow};
use crate::bridge::uploader::{BridgeUploader, ImessageIngestPayload};
use crate::bridge::{BridgeError, BridgeResult};

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub chat_db_path: PathBuf,
    pub cloud_origin: String,
    pub device_id: String,
    pub poll_interval: Duration,
    pub batch_size: usize,
    pub recent_rescan_days: i64,
}

#[derive(Debug, Clone, Default)]
pub struct SyncStatus {
    pub paused: bool,
    pub last_sync_ms: Option<i64>,
    pub last_synced_messages: usize,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum BridgeCommand {
    SyncNow,
    SetPaused(bool),
    Shutdown,
}

#[derive(Clone)]
pub struct BridgeSchedulerHandle {
    tx: mpsc::Sender<BridgeCommand>,
    status: Arc<Mutex<SyncStatus>>,
}

impl BridgeSchedulerHandle {
    pub async fn sync_now(&self) -> BridgeResult<()> {
        self.tx
            .send(BridgeCommand::SyncNow)
            .await
            .map_err(|_| BridgeError::Message("bridge_scheduler_channel_closed".to_string()))
    }

    pub async fn set_paused(&self, paused: bool) -> BridgeResult<()> {
        self.tx
            .send(BridgeCommand::SetPaused(paused))
            .await
            .map_err(|_| BridgeError::Message("bridge_scheduler_channel_closed".to_string()))
    }

    pub async fn shutdown(&self) -> BridgeResult<()> {
        self.tx
            .send(BridgeCommand::Shutdown)
            .await
            .map_err(|_| BridgeError::Message("bridge_scheduler_channel_closed".to_string()))
    }

    pub fn status(&self) -> SyncStatus {
        self.status
            .lock()
            .expect("bridge status mutex poisoned")
            .clone()
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time")
        .as_millis() as i64
}

fn enrich_rows(rows: &mut [ImessageRow]) {
    for row in rows.iter_mut() {
        if row.display_name.as_deref().unwrap_or("").trim().is_empty() {
            if let Some(handle) = row.handle.as_deref() {
                if let Some(contact) = enrich_handle_from_contacts(handle) {
                    row.display_name = contact.display_name;
                }
            }
        }
    }
}

async fn sync_once(
    config: &BridgeConfig,
    uploader: &BridgeUploader,
    token: &str,
    status: &Arc<Mutex<SyncStatus>>,
) -> BridgeResult<()> {
    let local_cursor = imessage_last_rowid()?;
    let remote_cursor = uploader
        .fetch_cursor(token, &config.device_id)
        .await
        .unwrap_or(0);
    let start_cursor = std::cmp::max(local_cursor, remote_cursor);
    if start_cursor != local_cursor {
        advance_imessage_cursor(start_cursor, now_ms())?;
    }

    let mut rows = fetch_since(&config.chat_db_path, start_cursor, config.batch_size)?;
    enrich_rows(&mut rows);
    let cursor_after = rows.last().map(|r| r.rowid).unwrap_or(start_cursor);
    let mutated_rows = fetch_recent_window(
        &config.chat_db_path,
        config.recent_rescan_days,
        (config.batch_size / 2).max(100),
    )
    .ok();

    if rows.is_empty() && mutated_rows.as_ref().map_or(true, |v| v.is_empty()) {
        let mut s = status.lock().expect("bridge status mutex poisoned");
        s.last_error = None;
        s.last_sync_ms = Some(now_ms());
        s.last_synced_messages = 0;
        return Ok(());
    }

    let payload = ImessageIngestPayload {
        device_id: config.device_id.clone(),
        batch: rows,
        cursor_after,
        mutated_rows,
    };
    let resp = uploader.upload_with_retry(token, &payload).await?;
    advance_imessage_cursor(resp.last_rowid, now_ms())?;

    let mut s = status.lock().expect("bridge status mutex poisoned");
    s.last_error = None;
    s.last_sync_ms = Some(now_ms());
    s.last_synced_messages = resp.accepted;
    Ok(())
}

pub fn start_bridge_scheduler(
    config: BridgeConfig,
    token: String,
) -> BridgeResult<BridgeSchedulerHandle> {
    let uploader = BridgeUploader::new(config.cloud_origin.clone())?;
    let (tx, mut rx) = mpsc::channel::<BridgeCommand>(32);
    let status = Arc::new(Mutex::new(SyncStatus::default()));
    let status_for_task = status.clone();

    tokio::spawn(async move {
        let mut tick = interval(config.poll_interval);
        loop {
            tokio::select! {
                _ = tick.tick() => {
                    let paused = status_for_task.lock().expect("bridge status mutex poisoned").paused;
                    if paused {
                        continue;
                    }
                    if let Err(err) = sync_once(&config, &uploader, &token, &status_for_task).await {
                        let mut s = status_for_task.lock().expect("bridge status mutex poisoned");
                        s.last_error = Some(err.to_string());
                    }
                }
                cmd = rx.recv() => {
                    let Some(cmd) = cmd else { break };
                    match cmd {
                        BridgeCommand::SyncNow => {
                            if let Err(err) = sync_once(&config, &uploader, &token, &status_for_task).await {
                                let mut s = status_for_task.lock().expect("bridge status mutex poisoned");
                                s.last_error = Some(err.to_string());
                            }
                        }
                        BridgeCommand::SetPaused(paused) => {
                            let mut s = status_for_task.lock().expect("bridge status mutex poisoned");
                            s.paused = paused;
                        }
                        BridgeCommand::Shutdown => break,
                    }
                }
            }
        }
    });

    Ok(BridgeSchedulerHandle { tx, status })
}
