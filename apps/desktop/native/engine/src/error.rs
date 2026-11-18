use std::fmt;

/// Why the engine refused a request. `code` is what the app sees.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    /// The file can't be read.
    NotFound(String),
    /// The file isn't audio Wave plays.
    Unsupported(String),
    /// The file broke while decoding or seeking.
    Decode(String),
    /// A call that needs a song came before any was loaded.
    NothingLoaded,
}

impl EngineError {
    pub fn code(&self) -> &'static str {
        match self {
            EngineError::NotFound(_) => "not-found",
            EngineError::Unsupported(_) => "unsupported",
            EngineError::Decode(_) => "decode",
            EngineError::NothingLoaded => "nothing-loaded",
        }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::NotFound(why) => write!(f, "can't read the file: {why}"),
            EngineError::Unsupported(why) => write!(f, "not a format Wave plays: {why}"),
            EngineError::Decode(why) => write!(f, "can't decode the file: {why}"),
            EngineError::NothingLoaded => write!(f, "no song is loaded"),
        }
    }
}

impl std::error::Error for EngineError {}
