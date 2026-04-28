use crate::bridge::BridgeResult;

const KEYCHAIN_SERVICE: &str = "com.cirne.brain.bridge";
const KEYCHAIN_ACCOUNT: &str = "device-token";

fn entry() -> keyring::Entry {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).expect("keyring entry")
}

pub fn load_device_token() -> BridgeResult<Option<String>> {
    let e = entry();
    match e.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

pub fn save_device_token(token: &str) -> BridgeResult<()> {
    let e = entry();
    e.set_password(token)?;
    Ok(())
}

pub fn clear_device_token() -> BridgeResult<()> {
    let e = entry();
    match e.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn keychain_round_trip() {
        let token = "brn_dev_test.secret";
        if save_device_token(token).is_err() {
            return;
        }
        let loaded = load_device_token().ok().flatten();
        if loaded.as_deref() != Some(token) {
            return;
        }
        let _ = clear_device_token();
    }
}
