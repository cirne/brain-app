//! Wall-clock deadlines and cooperative shutdown for long-running CLI work (sync).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, Once};
use std::time::{Duration, Instant};

static DEADLINE: Mutex<Option<Instant>> = Mutex::new(None);
static SHUTDOWN: AtomicBool = AtomicBool::new(false);
static CTRLC_ONCE: Once = Once::new();

/// Parse `RIPMAIL_IMAP_CONNECT_TIMEOUT_SECS` (default 120s).
pub fn imap_connect_timeout() -> Duration {
    std::env::var("RIPMAIL_IMAP_CONNECT_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&s| s > 0)
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(120))
}

/// Wall-clock cap for `refresh` and `backfill --foreground` when the global [`arm`] is used.
/// Precedence: CLI `--timeout` (0 = no limit) → `RIPMAIL_TIMEOUT` from the environment → unbounded.
pub fn resolve_sync_wall_timeout_secs(global_timeout_arg: Option<u64>) -> Option<u64> {
    if global_timeout_arg == Some(0) {
        return None;
    }
    if let Some(n) = global_timeout_arg {
        if n > 0 {
            return Some(n);
        }
    }
    if let Ok(s) = std::env::var("RIPMAIL_TIMEOUT") {
        if s == "0" {
            return None;
        }
        if let Ok(n) = s.parse::<u64>() {
            if n > 0 {
                return Some(n);
            }
        }
    }
    None
}

/// Arm wall-clock deadline and register SIGINT/SIGTERM handler. Pass **resolved** seconds
/// (see [`resolve_sync_wall_timeout_secs`] for `refresh` / backfill) or from other policies.
pub fn arm(resolved_timeout_secs: Option<u64>) {
    {
        let mut g = DEADLINE.lock().unwrap();
        *g = resolved_timeout_secs
            .filter(|&s| s > 0)
            .map(|s| Instant::now() + Duration::from_secs(s));
    }
    SHUTDOWN.store(false, Ordering::SeqCst);
    CTRLC_ONCE.call_once(|| {
        let _ = ctrlc::set_handler(|| {
            SHUTDOWN.store(true, Ordering::SeqCst);
            eprintln!("ripmail: signal received; stopping after current unit of work…");
        });
    });
}

pub fn disarm() {
    let mut g = DEADLINE.lock().unwrap();
    *g = None;
    SHUTDOWN.store(false, Ordering::SeqCst);
}

pub fn shutdown_requested() -> bool {
    SHUTDOWN.load(Ordering::SeqCst)
}

pub fn wall_clock_expired() -> bool {
    let g = DEADLINE.lock().unwrap();
    g.map(|t| Instant::now() >= t).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::resolve_sync_wall_timeout_secs;
    use std::sync::{Mutex, OnceLock};

    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("lock")
    }

    fn with_cleared_ripmail_timeout_env<F, R>(f: F) -> R
    where
        F: FnOnce() -> R,
    {
        let _g = lock();
        let t_bak = std::env::var("RIPMAIL_TIMEOUT").ok();
        std::env::remove_var("RIPMAIL_TIMEOUT");
        let out = f();
        match t_bak {
            None => std::env::remove_var("RIPMAIL_TIMEOUT"),
            Some(v) => std::env::set_var("RIPMAIL_TIMEOUT", v),
        }
        out
    }

    #[test]
    fn resolve_sync_cli_zero_is_unlimited() {
        with_cleared_ripmail_timeout_env(|| {
            assert_eq!(resolve_sync_wall_timeout_secs(Some(0)), None);
        });
    }

    #[test]
    fn resolve_sync_cli_wins() {
        with_cleared_ripmail_timeout_env(|| {
            std::env::set_var("RIPMAIL_TIMEOUT", "2");
            assert_eq!(resolve_sync_wall_timeout_secs(Some(1)), Some(1));
        });
    }

    #[test]
    fn resolve_sync_ripmail_timeout_env_second() {
        with_cleared_ripmail_timeout_env(|| {
            std::env::set_var("RIPMAIL_TIMEOUT", "10");
            assert_eq!(resolve_sync_wall_timeout_secs(None), Some(10));
        });
    }

    #[test]
    fn resolve_sync_none_when_no_cli_no_env() {
        with_cleared_ripmail_timeout_env(|| {
            assert_eq!(resolve_sync_wall_timeout_secs(None), None);
        });
    }
}
