//! The error type returned by every backend operation and serialized to the UI.

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0} is not inside a git repository")]
    NotARepo(String),
    #[error("git is required and could not be found on the system path")]
    GitNotFound,
    #[error("git {0} is too old; version 2.30 or newer is required")]
    GitTooOld(String),
    #[error("could not resolve revision '{0}'")]
    BadRevision(String),
    #[error("{0}")]
    Io(String),
    #[error("git failed: {0}")]
    Git(String),
    #[error("{0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, AppError>;

/// Machine-readable error category, for the UI to branch on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorKind {
    NotARepo,
    GitNotFound,
    GitTooOld,
    BadRevision,
    Io,
    Git,
    Invalid,
}

/// Wire form of [`AppError`]: `{ kind, message }`.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ErrorPayload {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    pub fn kind(&self) -> ErrorKind {
        match self {
            AppError::NotARepo(_) => ErrorKind::NotARepo,
            AppError::GitNotFound => ErrorKind::GitNotFound,
            AppError::GitTooOld(_) => ErrorKind::GitTooOld,
            AppError::BadRevision(_) => ErrorKind::BadRevision,
            AppError::Io(_) => ErrorKind::Io,
            AppError::Git(_) => ErrorKind::Git,
            AppError::Invalid(_) => ErrorKind::Invalid,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        ErrorPayload { kind: self.kind(), message: self.to_string() }.serialize(s)
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_kind_and_message() {
        let json = serde_json::to_value(AppError::BadRevision("nope".into())).unwrap();
        assert_eq!(json["kind"], "badRevision");
        assert_eq!(json["message"], "could not resolve revision 'nope'");
    }
}
