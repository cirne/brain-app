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

/// Arm wall-clock deadline (`--timeout` / `RIPMAIL_TIMEOUT` in seconds) and register SIGINT/SIGTERM handler.
pub fn arm(timeout_secs: Option<u64>) {
    let secs = timeout_secs.or_else(|| {
        std::env::var("RIPMAIL_TIMEOUT")
            .ok()
            .and_then(|s| s.parse().ok())
    });
    {
        let mut g = DEADLINE.lock().unwrap();
        *g = secs
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
