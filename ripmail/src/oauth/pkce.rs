//! PKCE (RFC 7636) code verifier and S256 challenge for Google OAuth Desktop flow.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::Digest;

/// Random URL-safe verifier (43–128 chars per RFC 7636).
pub fn new_code_verifier() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// BASE64URL(SHA256(verifier)) without padding.
#[must_use]
pub fn code_challenge_s256(verifier: &str) -> String {
    let hash = sha2::Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_length() {
        let v = new_code_verifier();
        assert!(v.len() >= 43);
    }

    #[test]
    fn challenge_deterministic() {
        let v = "test-verifier";
        let c1 = code_challenge_s256(v);
        let c2 = code_challenge_s256(v);
        assert_eq!(c1, c2);
        assert!(!c1.contains('='));
    }
}
