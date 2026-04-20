/// This test exists solely to prevent accidental use of `cargo test`.
///
/// cargo-nextest sets NEXTEST=1 in every test process. The standard
/// Rust test harness does not. So this test passes under nextest and
/// fails immediately under `cargo test`, printing a clear error.
#[test]
fn require_nextest() {
    assert!(
        std::env::var("NEXTEST").is_ok(),
        "\n\nSTOP: use `cargo nextest run` instead of `cargo test`.\n\
         The standard harness runs tests serially and is not supported here.\n"
    );
}
