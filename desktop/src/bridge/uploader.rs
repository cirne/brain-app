use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use tokio::time::sleep;

use crate::bridge::imessage::ImessageRow;
use crate::bridge::{BridgeError, BridgeResult};

#[derive(Debug, Clone, Serialize)]
pub struct ImessageIngestPayload {
    pub device_id: String,
    pub batch: Vec<ImessageRow>,
    pub cursor_after: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutated_rows: Option<Vec<ImessageRow>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImessageIngestResponse {
    pub ok: bool,
    pub accepted: usize,
    pub last_rowid: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImessageCursorResponse {
    pub ok: bool,
    pub rowid: i64,
}

#[derive(Clone)]
pub struct BridgeUploader {
    pub base_url: String,
    client: reqwest::Client,
}

impl BridgeUploader {
    pub fn new(base_url: String) -> BridgeResult<Self> {
        let parsed = reqwest::Url::parse(base_url.trim_end_matches('/'))
            .map_err(|e| BridgeError::Message(format!("invalid_cloud_origin: {e}")))?;
        if parsed.scheme() != "https" {
            let is_local_dev = cfg!(debug_assertions) && parsed.host_str() == Some("localhost");
            if !is_local_dev {
                return Err(BridgeError::Message(
                    "bridge uploader requires https cloud origin".to_string(),
                ));
            }
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()?;
        Ok(Self { base_url, client })
    }

    pub async fn fetch_cursor(&self, token: &str, device_id: &str) -> BridgeResult<i64> {
        let url = format!(
            "{}/api/ingest/imessage/cursor?device_id={}",
            self.base_url.trim_end_matches('/'),
            urlencoding::encode(device_id)
        );
        let resp = self
            .client
            .get(url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await?;
        if resp.status() == StatusCode::UNAUTHORIZED || resp.status() == StatusCode::FORBIDDEN {
            return Err(BridgeError::Message("device_token_rejected".to_string()));
        }
        let parsed = resp.json::<ImessageCursorResponse>().await?;
        if !parsed.ok {
            return Err(BridgeError::Message("cursor_not_ok".to_string()));
        }
        Ok(parsed.rowid)
    }

    pub async fn upload_with_retry(
        &self,
        token: &str,
        payload: &ImessageIngestPayload,
    ) -> BridgeResult<ImessageIngestResponse> {
        let mut attempt = 0usize;
        let max_attempts = 4usize;
        loop {
            attempt += 1;
            match self.upload_once(token, payload).await {
                Ok(ok) => return Ok(ok),
                Err(err) => {
                    if attempt >= max_attempts {
                        return Err(err);
                    }
                    let backoff_ms = 250u64 * (1u64 << (attempt as u32));
                    sleep(Duration::from_millis(backoff_ms)).await;
                }
            }
        }
    }

    async fn upload_once(
        &self,
        token: &str,
        payload: &ImessageIngestPayload,
    ) -> BridgeResult<ImessageIngestResponse> {
        let url = format!(
            "{}/api/ingest/imessage",
            self.base_url.trim_end_matches('/')
        );
        let resp = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {token}"))
            .json(payload)
            .send()
            .await?;

        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(BridgeError::Message("device_token_rejected".to_string()));
        }
        if status.is_server_error() {
            return Err(BridgeError::Message(format!(
                "server_error_{}",
                status.as_u16()
            )));
        }
        if !status.is_success() {
            return Err(BridgeError::Message(format!(
                "ingest_failed_{}",
                status.as_u16()
            )));
        }
        let parsed = resp.json::<ImessageIngestResponse>().await?;
        if !parsed.ok {
            return Err(BridgeError::Message("ingest_not_ok".to_string()));
        }
        Ok(parsed)
    }
}
