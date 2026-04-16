//! Dev CLI: explore Apple Mail `Envelope Index` + `.emlx` (OPP-050 feasibility).
//!
//! ```text
//! cargo run --bin applemail-explore -- discover
//! cargo run --bin applemail-explore -- schema
//! cargo run --bin applemail-explore -- messages 10
//! cargo run --bin applemail-explore -- read 12345
//! cargo run --bin applemail-explore -- read-file /path/to/x.emlx
//! cargo run --bin applemail-explore -- inspect
//! ```

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use rusqlite::Connection;

#[derive(Parser)]
#[command(name = "applemail-explore")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List `~/Library/Mail/V*` roots that contain `MailData`.
    Discover,
    /// Dump `sqlite_master` from Envelope Index.
    Schema {
        #[arg(long, value_name = "PATH")]
        root: Option<PathBuf>,
    },
    /// Print recent rows from `messages` (dynamic columns).
    Messages {
        #[arg(default_value_t = 10)]
        limit: usize,
        #[arg(long, value_name = "PATH")]
        root: Option<PathBuf>,
    },
    /// Resolve `.emlx` for a `messages.ROWID` and print inner MIME (lossy UTF-8).
    Read {
        rowid: i64,
        #[arg(long, value_name = "PATH")]
        root: Option<PathBuf>,
    },
    /// Read one `.emlx` or `.eml` file from disk (inner MIME for `.emlx`).
    ReadFile { path: PathBuf },
    /// Empirical summary: `messages` schema, date ranges, newest rows (`remote_id`, `--since` date).
    Inspect {
        #[arg(default_value_t = 8, value_name = "N")]
        sample: usize,
        #[arg(long, value_name = "PATH")]
        root: Option<PathBuf>,
    },
}

fn mail_root(cli_root: Option<PathBuf>) -> PathBuf {
    cli_root
        .or_else(|| {
            dirs::home_dir().and_then(|h| ripmail::applemail::default_mail_library_root(&h))
        })
        .expect("No Mail library root: pass --root or use macOS with ~/Library/Mail/V*")
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Discover => {
            let Some(home) = dirs::home_dir() else {
                eprintln!("no home directory");
                std::process::exit(1);
            };
            let roots = ripmail::applemail::discover_mail_library_roots(&home);
            if roots.is_empty() {
                println!("(no V*/MailData under ~/Library/Mail — Full Disk Access?)");
            }
            for r in roots {
                println!("{}", r.display());
            }
        }
        Commands::Schema { root } => {
            let root = mail_root(root);
            let index = ripmail::applemail::envelope_index_path(&root);
            let conn = ripmail::applemail::open_envelope_readonly(&index)
                .unwrap_or_else(|e| panic!("open {}: {e}", index.display()));
            let dump = ripmail::applemail::schema_dump(&conn).expect("schema");
            print!("{dump}");
        }
        Commands::Messages { limit, root } => {
            let root = mail_root(root);
            let index = ripmail::applemail::envelope_index_path(&root);
            let conn = ripmail::applemail::open_envelope_readonly(&index)
                .unwrap_or_else(|e| panic!("open {}: {e}", index.display()));
            let rows = ripmail::applemail::sample_messages(&conn, limit).expect("messages");
            for r in rows {
                println!(
                    "ROWID={} remote_id={:?} mailbox={:?} date_ymd={:?} cols={:?}",
                    r.rowid,
                    r.remote_id,
                    r.mailbox_rowid,
                    ripmail::applemail::envelope_received_date_ymd(&r),
                    r.columns
                );
            }
        }
        Commands::Read { rowid, root } => {
            let root = mail_root(root);
            let index = ripmail::applemail::envelope_index_path(&root);
            let conn = ripmail::applemail::open_envelope_readonly(&index)
                .unwrap_or_else(|e| panic!("open {}: {e}", index.display()));
            let Some(row) = ripmail::applemail::message_row_by_rowid(&conn, rowid).expect("query")
            else {
                eprintln!("no message with ROWID {rowid}");
                std::process::exit(1);
            };
            let Some(path) = ripmail::applemail::resolve_emlx_for_row(&root, &conn, &row) else {
                eprintln!("could not resolve .emlx for ROWID {rowid}");
                std::process::exit(1);
            };
            println!("{}", path.display());
            let bytes = ripmail::applemail::read_mail_file_bytes(&path)
                .unwrap_or_else(|e| panic!("read: {e}"));
            println!("---");
            print!("{}", String::from_utf8_lossy(&bytes));
        }
        Commands::ReadFile { path } => {
            let bytes = ripmail::applemail::read_mail_file_bytes(&path)
                .unwrap_or_else(|e| panic!("read: {e}"));
            print!("{}", String::from_utf8_lossy(&bytes));
        }
        Commands::Inspect { root, sample } => {
            let root = mail_root(root);
            let index = ripmail::applemail::envelope_index_path(&root);
            println!("Envelope Index: {}", index.display());
            let conn = match ripmail::applemail::open_envelope_readonly(&index) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("open {}: {e}", index.display());
                    std::process::exit(1);
                }
            };
            if let Err(e) = print_messages_table_info(&conn) {
                eprintln!("PRAGMA table_info(messages): {e}");
                std::process::exit(1);
            }
            let n: i64 = match conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0)) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("COUNT(*): {e}");
                    std::process::exit(1);
                }
            };
            println!("messages COUNT(*): {n}");
            let dr = conn.query_row(
                "SELECT MIN(date_received), MAX(date_received) FROM messages",
                [],
                |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?)),
            );
            if let Ok((Some(lo), Some(hi))) = dr {
                println!("date_received MIN/MAX (raw INTEGER): {lo} {hi}");
                println!(
                    "  as ripmail apple_mail_time_to_ymd(MIN): {:?}",
                    ripmail::applemail::apple_mail_time_to_ymd(lo as f64)
                );
                println!(
                    "  as ripmail apple_mail_time_to_ymd(MAX): {:?}",
                    ripmail::applemail::apple_mail_time_to_ymd(hi as f64)
                );
            }
            println!("--- newest {sample} rows (ORDER BY ROWID DESC) ---");
            let rows = match ripmail::applemail::sample_messages_page(&conn, sample, 0) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("sample messages: {e}");
                    std::process::exit(1);
                }
            };
            for r in rows {
                let ymd = ripmail::applemail::envelope_received_date_ymd(&r);
                let stem = r.emlx_file_stem_id();
                println!(
                    "ROWID={} remote_id={:?} emlx_stem={stem} mailbox={:?} date_received={:?} date_sent={:?} -> ymd={:?}",
                    r.rowid,
                    r.remote_id,
                    r.mailbox_rowid,
                    r.date_received,
                    r.date_sent,
                    ymd,
                );
            }
        }
    }
}

fn print_messages_table_info(conn: &Connection) -> rusqlite::Result<()> {
    println!("--- PRAGMA table_info(messages) ---");
    let mut stmt = conn.prepare("PRAGMA table_info(messages)")?;
    let cols = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    for c in cols {
        let (cid, name, typ) = c?;
        println!("  {cid} {name} {typ}");
    }
    Ok(())
}
