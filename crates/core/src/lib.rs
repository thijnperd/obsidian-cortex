//! Cortex core: turn a folder of Markdown files into a typed link graph.
//!
//! Everything in this crate is deterministic and free of I/O beyond the vault
//! scan, so the same code feeds the HTTP server, the CLI exporter and the
//! unit tests.

pub mod dates;
pub mod demo;
pub mod error;
pub mod graph;
pub mod layout;
pub mod markdown;
pub mod registry;
pub mod search;
pub mod store;
pub mod structures;
pub mod synthesis;
pub mod vault;

pub use error::{Error, Result};
pub use graph::GraphData;
pub use vault::Vault;

/// Move `temp` onto `target`.
///
/// On Unix this is an atomic rename. Windows refuses to rename onto a file
/// that still exists, so the target is removed first; the temp file survives a
/// failure either way, so nothing is lost if the second step goes wrong.
pub(crate) fn replace_file(
    temp: &std::path::Path,
    target: &std::path::Path,
) -> std::io::Result<()> {
    #[cfg(windows)]
    if target.exists() {
        std::fs::remove_file(target)?;
    }
    std::fs::rename(temp, target)
}
