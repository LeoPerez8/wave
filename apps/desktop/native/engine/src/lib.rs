//! Wave's desktop audio engine (docs/spec-desktop.md › Audio engine).

pub mod cache;
pub mod decode;
pub mod engine;
mod error;
mod gapless;
pub mod output;
pub mod player;
pub mod stream;

pub use error::EngineError;
