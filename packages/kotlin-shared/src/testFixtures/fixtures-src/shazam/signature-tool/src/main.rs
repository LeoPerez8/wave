//! Writes the fixtures for Wave's Kotlin port of shazamio-core's signature.
//!
//! `wave-signature-tool <in.wav> <out.pcm>` runs shazamio-core 2.0.0's own
//! `fingerprinting` sources (included unchanged by path, below) on a WAV file:
//! decode, mix down, resample to 16 kHz, fingerprint. It writes the 16 kHz
//! samples the signature generator was fed to `out.pcm` (signed 16-bit
//! little-endian, mono) and prints two lines: the data URI that pipeline gives
//! for the WAV file, and the one the generator gives for `out.pcm` alone.
//! `make_fixtures.py` checks both against the PyPI wheel.

// shazamio-core's Python entry points use what this leaves unused.
#![allow(dead_code)]

mod fingerprinting {
    #[path = "../../shazamio-core/src/fingerprinting/algorithm.rs"]
    pub mod algorithm;
    // A WAV reader standing in for shazamio-core's `symphonia` one (which also
    //  needs libopus); `make_fixtures.py` proves the two agree on its inputs.
    pub mod decode;
    #[path = "../../shazamio-core/src/fingerprinting/hanning.rs"]
    pub mod hanning;
    #[path = "../../shazamio-core/src/fingerprinting/resample.rs"]
    pub mod resample;
    #[path = "../../shazamio-core/src/fingerprinting/signature_format.rs"]
    pub mod signature_format;
}

use fingerprinting::algorithm::{SignatureGenerator, SAMPLE_RATE_HZ};
use fingerprinting::decode::MonoDecoder;
use fingerprinting::resample::Resampling;
use std::error::Error;
use std::path::Path;

// What `SignatureGenerator::pcm_samples` does (it is private): the 16 kHz stream the
//  generator gets. The fixtures are shorter than the 10 s default segment, so
//  `middle_segment` hands it over whole.
fn pcm_samples(path: &Path) -> Result<Vec<i16>, Box<dyn Error>> {
    let mut decoder = MonoDecoder::from_file(path)?;
    let mut resampling = Resampling::new(decoder.spec().rate())?;
    let mut mono_frames = Vec::new();
    while decoder.next_chunk(&mut mono_frames)? {
        resampling.push(&mono_frames)?;
    }
    resampling.finish()
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments: Vec<String> = std::env::args().collect();
    let [_, wav, pcm] = arguments.as_slice() else {
        return Err("usage: wave-signature-tool <in.wav> <out.pcm>".into());
    };

    let samples = pcm_samples(Path::new(wav))?;
    if samples.len() > 10 * SAMPLE_RATE_HZ as usize {
        return Err("keep fixtures under the 10 s default segment".into());
    }
    let bytes: Vec<u8> = samples.iter().flat_map(|sample| sample.to_le_bytes()).collect();
    std::fs::write(pcm, bytes)?;

    let from_file = SignatureGenerator::make_signature_from_file(Path::new(wav), None)?;
    let from_buffer = SignatureGenerator::make_signature_from_buffer(samples);
    println!("{}", from_file.encode_to_uri()?);
    println!("{}", from_buffer.encode_to_uri()?);
    Ok(())
}
