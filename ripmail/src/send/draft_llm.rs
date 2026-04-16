//! LLM compose for drafts (`compose-new-draft.ts`, `draft-rewrite.ts`).

use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessage,
    ChatCompletionRequestSystemMessageContent, ChatCompletionRequestUserMessage,
    ChatCompletionRequestUserMessageContent, CreateChatCompletionRequestArgs, ResponseFormat,
    ResponseFormatJsonSchema,
};

use super::draft_store::DraftFile;
use super::forward_excerpt::ForwardSourceExcerpt;
use crate::config::{build_llm_client, DraftComposeIdentity, LlmProvider, ResolvedLlm};

const COMPOSE_SYSTEM: &str = r#"You compose a new email from the user's instruction.

Return a single JSON object with exactly these keys:
- "subject" (string): a concise email subject line.
- "body" (string): the full message body. The user may want Markdown (headings, lists, emphasis); use it when it helps readability unless the instruction asks for plain text only.

Follow the instruction for tone, content, and length. Do not include a "Subject:" line inside the body.

If the user message includes `sender` with `preferredName`, `fullName`, `mailboxEmail`, or `signatureText`, sign the email using that information. Never use placeholder tokens such as [your name], [Your Name], or similar."#;

const REPLY_COMPOSE_SYSTEM: &str = r#"You compose a reply email from the user's instruction and the source message they are replying to.

Return a single JSON object with exactly these keys:
- "subject" (string): a concise subject line. Use "Re: …" when appropriate (match or extend the original subject).
- "body" (string): the full reply body only. Do not paste the entire original message unless the instruction asks for a quote. Markdown is allowed when it helps readability unless the instruction asks for plain text.

Do not include email headers in the body. Do not include a "Subject:" line inside the body.

If the user message includes `sender` with `preferredName`, `fullName`, `mailboxEmail`, or `signatureText`, sign the reply using that information. Never use placeholder tokens such as [your name] or similar."#;

const FORWARD_PREAMBLE_SYSTEM: &str = r#"You write a short preamble for forwarding an email: the optional note the sender adds before the standard forwarded-message block (which is appended separately).

Return a single JSON object with exactly this key:
- "preamble" (string): the note text only (may be empty if the instruction asks to forward without comment). Do not include forwarded headers or the original body.

If the user message includes `sender` with identity fields, use that voice; never use placeholder tokens such as [your name], [Your Name], or similar."#;

const REWRITE_SYSTEM: &str = r#"You revise an email draft based on the user's instruction.

Return a single JSON object with exactly these keys:
- "body" (string): the full revised message body only. No "Subject:" line inside the body. The user may use Markdown; preserve that style when appropriate unless the instruction asks otherwise.
- "subject" (string or null): a new subject line ONLY if the instruction clearly requires changing the subject; otherwise null.

Apply the instruction faithfully (remove sections, change tone, fix typos, shorten, etc.). Preserve parts the instruction does not ask to change. If something is ambiguous, prefer minimal edits.

If the user message includes `sender` with identity fields, use that voice; never use placeholder tokens such as [your name] or similar."#;

fn merge_sender_into_user_json(
    mut base: serde_json::Value,
    identity: Option<&DraftComposeIdentity>,
) -> String {
    if let Some(id) = identity {
        base["sender"] = serde_json::json!({
            "mailboxEmail": id.mailbox_email,
            "preferredName": id.preferred_name,
            "fullName": id.full_name,
            "signatureText": id.signature_body,
        });
    }
    base.to_string()
}

#[derive(Clone, Copy)]
enum DraftJsonKind {
    Compose,
    ReplyCompose,
    ForwardPreamble,
    Rewrite,
}

/// OpenAI now rejects legacy `response_format: { type: "json_object" }` for some models; use
/// structured outputs (`json_schema`). Ollama often lacks full support — rely on the system prompt only.
fn draft_response_format(llm: &ResolvedLlm, kind: DraftJsonKind) -> Option<ResponseFormat> {
    match llm.provider {
        LlmProvider::OpenAi | LlmProvider::Anthropic => {
            let (name, schema) = match kind {
                DraftJsonKind::Compose => (
                    "ripmail_draft_compose",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "subject": { "type": "string" },
                            "body": { "type": "string" }
                        },
                        "required": ["subject", "body"],
                        "additionalProperties": false
                    }),
                ),
                DraftJsonKind::ReplyCompose => (
                    "ripmail_draft_reply_compose",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "subject": { "type": "string" },
                            "body": { "type": "string" }
                        },
                        "required": ["subject", "body"],
                        "additionalProperties": false
                    }),
                ),
                DraftJsonKind::ForwardPreamble => (
                    "ripmail_draft_forward_preamble",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "preamble": { "type": "string" }
                        },
                        "required": ["preamble"],
                        "additionalProperties": false
                    }),
                ),
                DraftJsonKind::Rewrite => (
                    "ripmail_draft_rewrite",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "body": { "type": "string" },
                            "subject": { "type": ["string", "null"] }
                        },
                        "required": ["body", "subject"],
                        "additionalProperties": false
                    }),
                ),
            };
            Some(ResponseFormat::JsonSchema {
                json_schema: ResponseFormatJsonSchema {
                    name: name.to_string(),
                    description: None,
                    schema: Some(schema),
                    strict: Some(true),
                },
            })
        }
        LlmProvider::Ollama => None,
    }
}

async fn chat_json_object(
    llm: &ResolvedLlm,
    system: &str,
    user_json: &str,
    kind: DraftJsonKind,
) -> Result<String, String> {
    let c = build_llm_client(llm);
    let messages = vec![
        ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage {
            content: ChatCompletionRequestSystemMessageContent::Text(system.to_string()),
            name: None,
        }),
        ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage {
            content: ChatCompletionRequestUserMessageContent::Text(user_json.to_string()),
            name: None,
        }),
    ];
    let req = match draft_response_format(llm, kind) {
        Some(rf) => CreateChatCompletionRequestArgs::default()
            .model(llm.default_model.as_str())
            .messages(messages)
            .response_format(rf)
            .build()
            .map_err(|e| e.to_string())?,
        None => CreateChatCompletionRequestArgs::default()
            .model(llm.default_model.as_str())
            .messages(messages)
            .build()
            .map_err(|e| e.to_string())?,
    };
    let resp = c.chat().create(req).await.map_err(|e| e.to_string())?;
    let content = resp
        .choices
        .first()
        .and_then(|c| c.message.content.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "empty model response".to_string())?;
    Ok(content)
}

/// Subject and body for a new draft from natural-language instruction.
pub async fn compose_new_draft_from_instruction(
    to: Vec<String>,
    instruction: &str,
    llm: &ResolvedLlm,
    identity: Option<&DraftComposeIdentity>,
) -> Result<(String, String), String> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err("Compose instruction is empty".into());
    }
    if to.is_empty() {
        return Err("At least one recipient (to) is required".into());
    }
    let user = merge_sender_into_user_json(
        serde_json::json!({ "instruction": instruction, "to": to }),
        identity,
    );
    let raw = chat_json_object(llm, COMPOSE_SYSTEM, &user, DraftJsonKind::Compose).await?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "Model returned invalid JSON".to_string())?;
    let subj = v
        .get("subject")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            r#"Model response must include a non-empty string "subject" field"#.to_string()
        })?;
    let body = v
        .get("body")
        .and_then(|x| x.as_str())
        .ok_or_else(|| r#"Model response must include a string "body" field"#.to_string())?;
    Ok((subj.to_string(), body.to_string()))
}

fn source_message_json(excerpt: &ForwardSourceExcerpt) -> serde_json::Value {
    serde_json::json!({
        "from": excerpt.from_line,
        "date": excerpt.date_line,
        "subject": excerpt.subject_line,
        "body": excerpt.body_text,
    })
}

/// Subject and body for a reply draft from natural-language instruction and indexed source context.
pub async fn compose_reply_draft_from_instruction(
    to: Vec<String>,
    instruction: &str,
    excerpt: &ForwardSourceExcerpt,
    llm: &ResolvedLlm,
    identity: Option<&DraftComposeIdentity>,
) -> Result<(String, String), String> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err("Reply compose instruction is empty".into());
    }
    if to.is_empty() {
        return Err("At least one recipient (to) is required".into());
    }
    let user = merge_sender_into_user_json(
        serde_json::json!({
            "instruction": instruction,
            "to": to,
            "sourceMessage": source_message_json(excerpt),
        }),
        identity,
    );
    let raw = chat_json_object(
        llm,
        REPLY_COMPOSE_SYSTEM,
        &user,
        DraftJsonKind::ReplyCompose,
    )
    .await?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "Model returned invalid JSON".to_string())?;
    let subj = v
        .get("subject")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            r#"Model response must include a non-empty string "subject" field"#.to_string()
        })?;
    let body = v
        .get("body")
        .and_then(|x| x.as_str())
        .ok_or_else(|| r#"Model response must include a string "body" field"#.to_string())?;
    Ok((subj.to_string(), body.to_string()))
}

/// Preamble text for a forward draft (before the forwarded block), from natural-language instruction.
pub async fn compose_forward_preamble_from_instruction(
    to: Vec<String>,
    instruction: &str,
    excerpt: &ForwardSourceExcerpt,
    llm: &ResolvedLlm,
    identity: Option<&DraftComposeIdentity>,
) -> Result<String, String> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err("Forward preamble instruction is empty".into());
    }
    if to.is_empty() {
        return Err("At least one recipient (to) is required".into());
    }
    let user = merge_sender_into_user_json(
        serde_json::json!({
            "instruction": instruction,
            "to": to,
            "sourceMessage": source_message_json(excerpt),
        }),
        identity,
    );
    let raw = chat_json_object(
        llm,
        FORWARD_PREAMBLE_SYSTEM,
        &user,
        DraftJsonKind::ForwardPreamble,
    )
    .await?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "Model returned invalid JSON".to_string())?;
    v.get("preamble")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| r#"Model response must include a string "preamble" field"#.to_string())
}

pub struct RewriteDraftResult {
    pub body: String,
    pub subject: Option<String>,
}

/// Rewrite draft body (and optionally subject) from natural-language instruction.
pub async fn rewrite_draft_with_instruction(
    draft: &DraftFile,
    instruction: &str,
    llm: &ResolvedLlm,
    identity: Option<&DraftComposeIdentity>,
) -> Result<RewriteDraftResult, String> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err("Rewrite instruction is empty".into());
    }
    let fm = &draft.meta;
    let user = merge_sender_into_user_json(
        serde_json::json!({
            "instruction": instruction,
            "draftKind": fm.kind.as_deref().unwrap_or("new"),
            "recipients": {
                "to": fm.to.clone().unwrap_or_default(),
                "cc": fm.cc.clone().unwrap_or_default(),
                "bcc": fm.bcc.clone().unwrap_or_default(),
            },
            "currentSubject": fm.subject.as_deref().unwrap_or(""),
            "currentBody": draft.body,
        }),
        identity,
    );
    let raw = chat_json_object(llm, REWRITE_SYSTEM, &user, DraftJsonKind::Rewrite).await?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "Model returned invalid JSON".to_string())?;
    let body = v
        .get("body")
        .and_then(|x| x.as_str())
        .ok_or_else(|| r#"Model response must include a string "body" field"#.to_string())?
        .to_string();
    let subject = v.get("subject").and_then(|x| {
        if x.is_null() {
            None
        } else {
            x.as_str()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        }
    });
    Ok(RewriteDraftResult { body, subject })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_llm(provider: LlmProvider) -> ResolvedLlm {
        ResolvedLlm {
            provider,
            base_url: "https://api.openai.com/v1".into(),
            fast_model: "gpt-4.1-nano".into(),
            default_model: "gpt-4.1-mini".into(),
            api_key: "sk-test".into(),
        }
    }

    #[test]
    fn openai_uses_json_schema_not_json_object() {
        let llm = test_llm(LlmProvider::OpenAi);
        let rf = draft_response_format(&llm, DraftJsonKind::Compose).expect("format");
        match rf {
            ResponseFormat::JsonSchema { json_schema } => {
                assert_eq!(json_schema.name, "ripmail_draft_compose");
                assert!(json_schema.strict.unwrap_or(false));
                assert!(json_schema.schema.is_some());
            }
            ResponseFormat::JsonObject | ResponseFormat::Text => {
                panic!("expected JsonSchema for OpenAI, got {rf:?}");
            }
        }
    }

    #[test]
    fn openai_reply_compose_schema_name() {
        let llm = test_llm(LlmProvider::OpenAi);
        let rf = draft_response_format(&llm, DraftJsonKind::ReplyCompose).expect("format");
        match rf {
            ResponseFormat::JsonSchema { json_schema } => {
                assert_eq!(json_schema.name, "ripmail_draft_reply_compose");
            }
            _ => panic!("expected JsonSchema"),
        }
    }

    #[test]
    fn openai_forward_preamble_schema_name() {
        let llm = test_llm(LlmProvider::OpenAi);
        let rf = draft_response_format(&llm, DraftJsonKind::ForwardPreamble).expect("format");
        match rf {
            ResponseFormat::JsonSchema { json_schema } => {
                assert_eq!(json_schema.name, "ripmail_draft_forward_preamble");
            }
            _ => panic!("expected JsonSchema"),
        }
    }

    #[test]
    fn openai_rewrite_uses_strict_json_schema() {
        let llm = test_llm(LlmProvider::OpenAi);
        let rf = draft_response_format(&llm, DraftJsonKind::Rewrite).expect("format");
        match rf {
            ResponseFormat::JsonSchema { json_schema } => {
                assert_eq!(json_schema.name, "ripmail_draft_rewrite");
                assert!(json_schema.strict.unwrap_or(false));
            }
            _ => panic!("expected JsonSchema"),
        }
    }

    #[test]
    fn ollama_omits_response_format() {
        let llm = test_llm(LlmProvider::Ollama);
        assert!(draft_response_format(&llm, DraftJsonKind::Compose).is_none());
    }

    #[test]
    fn merge_sender_includes_identity_in_user_json() {
        let id = DraftComposeIdentity {
            mailbox_email: "a@b.com".into(),
            preferred_name: Some("Jane".into()),
            full_name: None,
            signature_body: Some("Thanks,\nJane".into()),
        };
        let s = merge_sender_into_user_json(serde_json::json!({ "instruction": "hi" }), Some(&id));
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["instruction"], "hi");
        assert_eq!(v["sender"]["mailboxEmail"], "a@b.com");
        assert_eq!(v["sender"]["preferredName"], "Jane");
        assert_eq!(v["sender"]["signatureText"], "Thanks,\nJane");
    }
}
