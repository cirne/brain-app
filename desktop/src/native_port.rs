//! Default HTTP port range for the bundled Brain server (Node picks from this list; see
//! `nativeAppPort.ts`). Tauri reads the bound port from child stdout (`BRAIN_LISTEN_PORT`), not
//! by probing TCP.
//! Must stay in sync with `src/server/lib/nativeAppPort.ts`.

#![allow(dead_code)]
// Kept public so the contract test below matches TypeScript; `server_spawn` uses stdout instead.

pub const NATIVE_APP_PORT_START: u16 = 18473;
pub const NATIVE_APP_PORT_END: u16 = 18522;
pub const NATIVE_APP_PORT_SKIP: u16 = 18516;

/// Same ordering as `nativeAppPortCandidates()` in TypeScript (skip IANA-reserved TCP 18516).
pub fn native_port_candidates() -> impl Iterator<Item = u16> {
    (NATIVE_APP_PORT_START..=NATIVE_APP_PORT_END).filter(|&p| p != NATIVE_APP_PORT_SKIP)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_match_ts_contract() {
        let v: Vec<u16> = native_port_candidates().collect();
        assert_eq!(v.first().copied(), Some(NATIVE_APP_PORT_START));
        assert_eq!(v.last().copied(), Some(NATIVE_APP_PORT_END));
        assert!(!v.contains(&NATIVE_APP_PORT_SKIP));
        assert_eq!(v.len(), 49);
    }
}
