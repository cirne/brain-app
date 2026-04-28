#[cfg(target_os = "macos")]
use objc2_contacts::CNContactStore;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::any::TypeId;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContactEnrichment {
    pub display_name: Option<String>,
    pub contact_identifier: Option<String>,
    pub organization: Option<String>,
}

#[allow(dead_code)]
pub fn normalize_phone_digits(input: &str) -> Option<String> {
    let stripped: String = input
        .chars()
        .filter(|c| !matches!(c, ' ' | '-' | '(' | ')' | '.' | '+'))
        .collect();
    if stripped.chars().filter(|c| c.is_ascii_alphabetic()).count() >= 2 {
        return None;
    }
    let digits: String = stripped.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 7 || digits.len() > 15 {
        return None;
    }
    if digits.len() == 11 && digits.starts_with('1') {
        return Some(digits[1..].to_string());
    }
    Some(digits)
}

#[allow(dead_code)]
pub fn canonicalize_imessage_chat_identifier(input: &str) -> String {
    let s = input.trim();
    if s.is_empty() {
        return String::new();
    }
    if s.contains('@') {
        return s.to_lowercase();
    }
    let Some(digits) = normalize_phone_digits(s) else {
        return s.to_string();
    };
    if digits.len() == 10 {
        format!("+1{digits}")
    } else if digits.len() == 11 && digits.starts_with('1') {
        format!("+1{}", &digits[1..])
    } else {
        format!("+{digits}")
    }
}

#[cfg(target_os = "macos")]
pub fn request_contacts_access() -> bool {
    let _ = TypeId::of::<CNContactStore>();
    // Placeholder for CNContactStore permission flow. We keep this explicit entrypoint so the
    // bridge can call it at onboarding time before first enrichment.
    true
}

#[cfg(not(target_os = "macos"))]
pub fn request_contacts_access() -> bool {
    false
}

#[cfg(target_os = "macos")]
pub fn enrich_handle_from_contacts(handle: &str) -> Option<ContactEnrichment> {
    // TODO: Wire objc2-contacts CNContactStore lookup by canonicalized phone/email.
    let _ = handle;
    None
}

#[cfg(not(target_os = "macos"))]
pub fn enrich_handle_from_contacts(handle: &str) -> Option<ContactEnrichment> {
    let _ = handle;
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_phone_and_email_identifiers() {
        assert_eq!(
            canonicalize_imessage_chat_identifier("(555) 000-1111"),
            "+15550001111".to_string()
        );
        assert_eq!(
            canonicalize_imessage_chat_identifier("Test@Example.COM"),
            "test@example.com".to_string()
        );
    }

    #[test]
    fn rejects_invalid_phone_input() {
        assert_eq!(normalize_phone_digits("abc"), None);
        assert_eq!(normalize_phone_digits("123"), None);
    }
}
