//! SASL XOAUTH2 initial client response (Gmail).

/// Build the XOAUTH2 initial response for `AUTHENTICATE XOAUTH2` (before base64 in IMAP).
#[must_use]
pub fn xoauth2_initial_response(user: &str, access_token: &str) -> String {
    format!("user={}\x01auth=Bearer {}\x01\x01", user, access_token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xoauth2_format_matches_google_example_shape() {
        let s = xoauth2_initial_response("u@gmail.com", "tok");
        assert!(s.starts_with("user=u@gmail.com\x01auth=Bearer tok\x01\x01"));
    }
}
