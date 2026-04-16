//! Injectable IMAP transport for sync (`run_sync`) and tests.

use std::collections::HashMap;
use std::path::Path;

use imap::types::Mailbox;
use imap::Connection;
use imap::Session;

use crate::config::{MailboxImapAuthKind, ResolvedMailbox};

use super::error::{enrich_imap_disconnect_message, RunSyncError};

/// STATUS / EXAMINE fields we care about for early-exit and checkpointing.
#[derive(Debug, Clone, Default)]
pub struct ImapStatusData {
    pub messages: Option<u32>,
    pub uid_next: Option<u32>,
    pub uid_validity: Option<u32>,
}

/// One message from UID FETCH.
#[derive(Debug, Clone)]
pub struct FetchedMessage {
    pub uid: u32,
    pub raw: Vec<u8>,
    pub labels: Vec<String>,
}

/// Minimal IMAP surface required by `run_sync`.
pub trait SyncImapTransport {
    fn mailbox_status(&mut self, mailbox: &str) -> Result<ImapStatusData, RunSyncError>;
    /// Returns UIDVALIDITY after EXAMINE (0 if missing).
    fn examine_mailbox(&mut self, mailbox: &str) -> Result<u32, RunSyncError>;
    fn uid_search_keys(&mut self, query: &str) -> Result<Vec<u32>, RunSyncError>;
    fn uid_fetch_rfc822_batch(
        &mut self,
        uid_csv: &str,
    ) -> Result<Vec<FetchedMessage>, RunSyncError>;
}

fn mailbox_to_status(m: &Mailbox) -> ImapStatusData {
    ImapStatusData {
        messages: Some(m.exists),
        uid_next: m.uid_next,
        uid_validity: m.uid_validity,
    }
}

/// Live IMAP session (`imap` crate).
pub struct RealImapTransport<'a> {
    pub session: &'a mut Session<Connection>,
}

impl SyncImapTransport for RealImapTransport<'_> {
    fn mailbox_status(&mut self, mailbox: &str) -> Result<ImapStatusData, RunSyncError> {
        let m = self
            .session
            .status(mailbox, "(MESSAGES UIDNEXT UIDVALIDITY)")
            .map_err(|e| RunSyncError::Imap(enrich_imap_disconnect_message(&e.to_string())))?;
        Ok(mailbox_to_status(&m))
    }

    fn examine_mailbox(&mut self, mailbox: &str) -> Result<u32, RunSyncError> {
        let m = self
            .session
            .examine(mailbox)
            .map_err(|e| RunSyncError::Imap(enrich_imap_disconnect_message(&e.to_string())))?;
        Ok(m.uid_validity.unwrap_or(0))
    }

    fn uid_search_keys(&mut self, query: &str) -> Result<Vec<u32>, RunSyncError> {
        let set = self
            .session
            .uid_search(query)
            .map_err(|e| RunSyncError::Imap(enrich_imap_disconnect_message(&e.to_string())))?;
        let mut v: Vec<u32> = set.iter().copied().collect();
        v.sort_unstable();
        Ok(v)
    }

    fn uid_fetch_rfc822_batch(
        &mut self,
        uid_csv: &str,
    ) -> Result<Vec<FetchedMessage>, RunSyncError> {
        if uid_csv.is_empty() {
            return Ok(Vec::new());
        }
        let query_gmail = "(UID BODY.PEEK[] X-GM-LABELS)";
        let fetches = match self.session.uid_fetch(uid_csv, query_gmail) {
            Ok(f) => Ok(f),
            Err(e) => {
                let es = e.to_string();
                if es.contains("X-GM-LABELS") || es.contains("BAD") || es.contains("Parse") {
                    self.session
                        .uid_fetch(uid_csv, "(UID BODY.PEEK[])")
                        .map_err(|e2| {
                            RunSyncError::Imap(enrich_imap_disconnect_message(&e2.to_string()))
                        })
                } else {
                    Err(RunSyncError::Imap(enrich_imap_disconnect_message(&es)))
                }
            }
        }?;

        let mut out = Vec::new();
        for fetch in fetches.iter() {
            let Some(uid) = fetch.uid else {
                continue;
            };
            let Some(raw) = fetch.body().map(|b| b.to_vec()) else {
                continue;
            };
            let labels: Vec<String> = fetch
                .gmail_labels()
                .map(|it| it.map(str::to_string).collect())
                .unwrap_or_default();
            out.push(FetchedMessage { uid, raw, labels });
        }
        Ok(out)
    }
}

/// Scripted transport for integration tests.
#[derive(Debug, Default)]
pub struct FakeImapTransport {
    pub status: ImapStatusData,
    pub uid_validity_on_examine: u32,
    pub search_uids: Vec<u32>,
    /// Each `uid_fetch_rfc822_batch` call pops the next vec (FIFO).
    pub fetch_batches: std::collections::VecDeque<Vec<FetchedMessage>>,
}

impl SyncImapTransport for FakeImapTransport {
    fn mailbox_status(&mut self, _mailbox: &str) -> Result<ImapStatusData, RunSyncError> {
        Ok(self.status.clone())
    }

    fn examine_mailbox(&mut self, _mailbox: &str) -> Result<u32, RunSyncError> {
        Ok(self.uid_validity_on_examine)
    }

    fn uid_search_keys(&mut self, _query: &str) -> Result<Vec<u32>, RunSyncError> {
        Ok(self.search_uids.clone())
    }

    fn uid_fetch_rfc822_batch(
        &mut self,
        _uid_csv: &str,
    ) -> Result<Vec<FetchedMessage>, RunSyncError> {
        Ok(self.fetch_batches.pop_front().unwrap_or_default())
    }
}

/// IMAP authentication: app password or Google XOAUTH2 access token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImapAuth<'a> {
    Password(&'a str),
    /// Gmail OAuth2 access token (Bearer) for SASL XOAUTH2.
    AccessToken(&'a str),
}

struct Xoauth2Authenticator {
    user: String,
    token: String,
}

impl imap::Authenticator for Xoauth2Authenticator {
    type Response = String;
    fn process(&self, _challenge: &[u8]) -> Self::Response {
        crate::oauth::xoauth2_initial_response(&self.user, &self.token)
    }
}

/// Connect and log in (TLS/STARTTLS per `ClientBuilder` defaults — port 993 uses TLS).
pub fn connect_imap_session_with_auth(
    host: &str,
    port: u16,
    user: &str,
    auth: ImapAuth<'_>,
) -> Result<Session<Connection>, RunSyncError> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| RunSyncError::Imap(enrich_imap_disconnect_message(&e.to_string())))?;
    match auth {
        ImapAuth::Password(password) => client
            .login(user, password)
            .map_err(|(e, _)| RunSyncError::Imap(enrich_imap_disconnect_message(&e.to_string()))),
        ImapAuth::AccessToken(token) => {
            let auth = Xoauth2Authenticator {
                user: user.to_string(),
                token: token.to_string(),
            };
            client.authenticate("XOAUTH2", &auth).map_err(|(e, _)| {
                RunSyncError::Imap(enrich_imap_disconnect_message(&e.to_string()))
            })
        }
    }
}

/// Connect with a plain password (legacy / app password).
pub fn connect_imap_session(
    host: &str,
    port: u16,
    user: &str,
    password: &str,
) -> Result<Session<Connection>, RunSyncError> {
    connect_imap_session_with_auth(host, port, user, ImapAuth::Password(password))
}

/// Connect using [`ResolvedMailbox`] credentials (app password or Google OAuth token).
pub fn connect_imap_for_resolved_mailbox(
    home: &Path,
    mb: &ResolvedMailbox,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<Session<Connection>, RunSyncError> {
    match mb.imap_auth {
        MailboxImapAuthKind::AppPassword => connect_imap_session(
            &mb.imap_host,
            mb.imap_port,
            &mb.imap_user,
            &mb.imap_password,
        ),
        MailboxImapAuthKind::GoogleOAuth => {
            let tok = crate::oauth::ensure_google_access_token(home, &mb.id, env_file, process_env)
                .map_err(|e| RunSyncError::Imap(enrich_imap_disconnect_message(&e.to_string())))?;
            connect_imap_session_with_auth(
                &mb.imap_host,
                mb.imap_port,
                &mb.imap_user,
                ImapAuth::AccessToken(&tok),
            )
        }
    }
}
