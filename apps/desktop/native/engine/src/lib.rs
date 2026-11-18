//! Wave's desktop audio engine (docs/spec-desktop.md › Audio engine).

pub mod decode;
pub mod engine;
mod error;
mod gapless;
pub mod loudness;
pub mod output;
pub mod player;

pub use error::EngineError;
