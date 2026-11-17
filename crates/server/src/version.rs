//! What this build calls itself.
//!
//! `Cargo.toml` and the release tag must agree; CI fails the release when they
//! do not. Local builds report `dev` instead of pretending to be a release.

/// Cargo's version, kept equal to the release tag by CI.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The tag CI built from (`v0.2.0`), or `dev` for a local build.
pub fn build() -> &'static str {
    option_env!("CORTEX_VERSION").unwrap_or("dev")
}

pub const RELEASES_URL: &str = "https://github.com/thijnperd/obsidian-cortex/releases";
