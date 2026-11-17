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
pub mod synthesis;
pub mod vault;

pub use error::{Error, Result};
pub use graph::GraphData;
pub use vault::Vault;
