//! Google OAuth 2.0 (Desktop + PKCE) for Gmail IMAP/SMTP via XOAUTH2 (OPP-042).

mod access;
mod client;
mod google_flow;
mod google_userinfo;
mod hosted_flow;
mod pkce;
mod token_http;
mod token_store;
mod xoauth2;

pub use access::{ensure_google_access_token, GoogleAccessTokenError};
pub use client::{
    resolve_google_oauth_client, resolve_google_oauth_client_with_diagnostics,
    resolve_oauth_relay_base, GoogleOAuthClientError, GoogleOAuthClientSettings,
    DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID, DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_SECRET,
    DEFAULT_PUBLIC_OAUTH_RELAY_BASE,
};
pub use google_flow::{
    run_google_oauth_interactive, GoogleOAuthInteractiveError, GOOGLE_OAUTH_SCOPE_DRIVE_READONLY,
    GOOGLE_OAUTH_SCOPE_MAIL, GOOGLE_OAUTH_SCOPE_MAIL_CALENDAR_EVENTS,
    GOOGLE_OAUTH_SCOPE_MAIL_CALENDAR_EVENTS_DRIVE, GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL,
    GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS,
    GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
};
pub use google_userinfo::{fetch_google_account_email, GoogleUserinfoError};
pub use hosted_flow::{run_google_oauth_hosted, GoogleOAuthHostedError};
pub use token_store::{
    google_oauth_credentials_present, google_oauth_token_path, load_google_oauth_token_store,
    load_google_oauth_token_store_for_mailbox, save_google_oauth_token_store,
    GoogleOAuthTokenStore,
};
pub use xoauth2::xoauth2_initial_response;
