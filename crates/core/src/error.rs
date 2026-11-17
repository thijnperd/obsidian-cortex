use std::fmt;
use std::io;

/// Errors produced while reading or writing a vault.
#[derive(Debug)]
pub enum Error {
    Io(io::Error),
    /// A caller-supplied note id failed validation.
    InvalidPath(String),
    TooLarge {
        limit: u64,
    },
    NotFound,
    /// The vault itself is unusable (missing folder, too many notes, ...).
    Vault(String),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Error::Io(e) if e.kind() == io::ErrorKind::NotFound => "not_found",
            Error::Io(_) => "io_error",
            Error::InvalidPath(_) => "invalid_path",
            Error::TooLarge { .. } => "too_large",
            Error::NotFound => "not_found",
            Error::Vault(_) => "vault_error",
        }
    }

    /// Client-safe message. Never includes filesystem paths.
    pub fn public_message(&self) -> &'static str {
        match self {
            Error::InvalidPath(_) => "invalid note id",
            Error::TooLarge { .. } => "note is too large",
            Error::NotFound => "note not found",
            Error::Io(e) if e.kind() == io::ErrorKind::NotFound => "note not found",
            Error::Io(_) => "storage error",
            Error::Vault(_) => "vault could not be read",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(e) => write!(f, "io error: {e}"),
            Error::InvalidPath(reason) => write!(f, "invalid note id: {reason}"),
            Error::TooLarge { limit } => write!(f, "note exceeds {limit} bytes"),
            Error::NotFound => f.write_str("note not found"),
            Error::Vault(msg) => write!(f, "vault error: {msg}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<io::Error> for Error {
    fn from(err: io::Error) -> Self {
        Error::Io(err)
    }
}

pub type Result<T> = std::result::Result<T, Error>;
