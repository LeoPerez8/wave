//! Wave's desktop audio engine (docs/spec-desktop.md › Audio engine).

pub mod decode;
pub mod player;
mod error;

pub use error::EngineError;
