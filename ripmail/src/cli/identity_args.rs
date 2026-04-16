//! Shared `--preferred-name` / `--signature` flags for `setup` and `config`.

use clap::Args;
use ripmail::IdentityPatch;

#[derive(Args, Clone, Debug, Default)]
pub struct IdentityArgs {
    /// How you go by (LLM compose, salutation).
    #[arg(long, env = "RIPMAIL_PREFERRED_NAME")]
    pub preferred_name: Option<String>,
    #[arg(long, env = "RIPMAIL_FULL_NAME")]
    pub full_name: Option<String>,
    /// Signature body; stored under `signatures` (default key `default` unless `--signature-id` is set).
    #[arg(long, env = "RIPMAIL_SIGNATURE")]
    pub signature: Option<String>,
    /// Active signature key in `identity.signatures`.
    #[arg(long, env = "RIPMAIL_SIGNATURE_ID")]
    pub signature_id: Option<String>,
}

impl IdentityArgs {
    /// Returns `None` when no identity fields are set (no merge).
    pub fn to_patch(&self) -> Option<IdentityPatch> {
        let preferred_name = trim_opt(self.preferred_name.as_ref());
        let full_name = trim_opt(self.full_name.as_ref());
        let signature = self.signature.as_ref().map(|s| s.to_string());
        let signature_id = trim_opt(self.signature_id.as_ref());
        let has = preferred_name.is_some()
            || full_name.is_some()
            || signature.is_some()
            || signature_id.is_some();
        if !has {
            return None;
        }
        Some(IdentityPatch {
            preferred_name,
            full_name,
            signature,
            signature_id,
        })
    }
}

fn trim_opt(s: Option<&String>) -> Option<String> {
    s.and_then(|x| {
        let t = x.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

/// True when any identity field is non-empty (for setup hint paths).
pub fn identity_args_nonempty(args: &IdentityArgs) -> bool {
    args.to_patch().is_some()
}
