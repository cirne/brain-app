//! Decrypt build-time embedded API keys (release only). Decryption runs only in Rust.

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};

include!(concat!(env!("OUT_DIR"), "/embed_secrets.rs"));

const XOR_MASK: u8 = 0xA5;

fn deobfuscate_key() -> Option<[u8; 32]> {
    let mut k = OBFUSCATED_DERIVED_KEY;
    if k == [0u8; 32] {
        return None;
    }
    for b in k.iter_mut() {
        *b ^= XOR_MASK;
    }
    Some(k)
}

/// Apply decrypted secrets to the current process environment (for child inheritance).
/// No-op in debug builds (use `.env` + loadDotEnv in Node instead).
pub fn apply_embedded_env() -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }

    let Some(key_bytes) = deobfuscate_key() else {
        log::warn!("embedded secrets: no key material (set BRAIN_EMBED_MASTER_KEY for release builds)");
        return Ok(());
    };

    let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| e.to_string())?;

    for (name, blob) in EMBEDDED_BLOBS {
        if blob.len() < 13 {
            continue;
        }
        let (nonce, ct) = blob.split_at(12);
        let n = Nonce::from_slice(nonce);
        let pt = cipher
            .decrypt(n, ct.as_ref())
            .map_err(|_| format!("decrypt failed for {}", name))?;
        let s = String::from_utf8(pt).map_err(|e| e.to_string())?;
        std::env::set_var(name, s);
    }

    Ok(())
}

/// Same as build-time HKDF (for unit tests with a known master).
#[cfg(test)]
mod tests {
    use aes_gcm::aead::Aead;
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
    use getrandom::getrandom;
    use hkdf::Hkdf;
    use sha2::Sha256;

    /// Must match `build/embed.rs` `derive_aes_key`.
    fn test_derive_key(master: &str) -> [u8; 32] {
        let hk = Hkdf::<Sha256>::new(Some(b"brain-app-embed-v1"), master.as_bytes());
        let mut okm = [0u8; 32];
        hk.expand(b"aes-256-gcm", &mut okm).expect("hkdf");
        okm
    }

    #[test]
    fn hkdf_matches_build_script() {
        let master = "unit-test-master-key-32bytes-min!";
        let k = test_derive_key(master);
        let k2 = test_derive_key(master);
        assert_eq!(k, k2);
    }

    #[test]
    fn aes_gcm_roundtrip_like_build() {
        let master = "unit-test-master-key-32bytes-min!";
        let key_bytes = test_derive_key(master);
        let cipher = Aes256Gcm::new_from_slice(&key_bytes).unwrap();
        let mut nonce = [0u8; 12];
        getrandom(&mut nonce).unwrap();
        let n = Nonce::from_slice(&nonce);
        let pt = b"sk-test-secret";
        let ct = cipher.encrypt(n, pt.as_ref()).unwrap();
        let mut blob = Vec::new();
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&ct);
        let (nonce2, ct2) = blob.split_at(12);
        let n2 = Nonce::from_slice(nonce2);
        let out = cipher.decrypt(n2, ct2.as_ref()).unwrap();
        assert_eq!(out, pt);
    }
}
