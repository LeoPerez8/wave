//! Golden tests: what the decoder outputs, compared sample by sample with the signal the test
//! files were made from.

mod common;

use common::{fixture, lag, snr, source_16bit};
use wave_audio::decode::Decoder;

fn decode_all(decoder: &mut Decoder) -> Vec<f32> {
    let mut pcm = Vec::new();
    while let Some(chunk) = decoder.next_chunk().expect("decodes") {
        pcm.extend_from_slice(&chunk);
    }
    pcm
}

fn decode_frames(decoder: &mut Decoder, frames: usize) -> Vec<f32> {
    let mut pcm = Vec::new();
    while pcm.len() < frames * 2 {
        match decoder.next_chunk().expect("decodes") {
            Some(chunk) => pcm.extend_from_slice(&chunk),
            None => break,
        }
    }
    pcm.truncate(frames * 2);
    pcm
}

/// Lossless files decode to exactly the 16-bit signal, from the start and after a seek.
fn assert_lossless(name: &str, rate: u32) {
    let mut decoder = Decoder::open(&fixture(name)).expect("opens");
    assert_eq!(decoder.sample_rate(), rate);
    assert_eq!(decoder.duration_frames(), Some(rate as u64));
    let pcm = decode_all(&mut decoder);
    assert_eq!(pcm.len(), rate as usize * 2, "{name}: frame count");
    for (n, frame) in pcm.chunks(2).enumerate() {
        assert_eq!(frame, source_16bit(n as u64, rate), "{name}: frame {n}");
    }

    let target = rate as u64 * 2 / 5 + 7;
    decoder.seek(target).expect("seeks");
    let after = decode_frames(&mut decoder, 2048);
    assert_eq!(after.len(), 4096, "{name}: frames after the seek");
    for (k, frame) in after.chunks(2).enumerate() {
        let n = target + k as u64;
        assert_eq!(frame, source_16bit(n, rate), "{name}: frame {n} after the seek");
    }
}

#[test]
fn wav_decodes_and_seeks_sample_exact() {
    assert_lossless("tone.wav", 22_050);
}

#[test]
fn flac_decodes_and_seeks_sample_exact() {
    assert_lossless("tone.flac", 22_050);
}

#[test]
fn alac_in_m4a_decodes_and_seeks_sample_exact() {
    assert_lossless("tone-alac.m4a", 22_050);
}

/// Lossy files decode to the signal within the codec's noise, lined up to the frame (`delay`
/// is where the decoder puts the signal's first frame), from the start and after a seek.
fn assert_lossy(name: &str, rate: u32, delay: i64, min_snr: f64) {
    let mut decoder = Decoder::open(&fixture(name)).expect("opens");
    assert_eq!(decoder.sample_rate(), rate, "{name}: rate");
    let duration = decoder.duration_frames().expect("knows its length");
    let pcm = decode_all(&mut decoder);
    assert_eq!(pcm.len() as u64 / 2, duration, "{name}: the length it states is what decodes");
    if delay == 0 {
        assert_eq!(duration, rate as u64, "{name}: trimmed to the signal's length");
    }
    let start = rate as u64 / 5;
    let (found, correlation) = lag(&pcm[start as usize * 2..], start, rate, 3000);
    assert_eq!(found, delay, "{name}: delay (correlation {correlation:.4})");
    let quality = snr(&pcm, (start as i64 + delay) as usize, start, rate, 8192);
    assert!(quality.iter().all(|&db| db >= min_snr), "{name}: SNR {quality:?} dB");

    let target = rate as u64 / 2 + 11;
    decoder.seek(target).expect("seeks");
    let after = decode_frames(&mut decoder, 8192);
    let (found, correlation) = lag(&after, target, rate, 3000);
    assert_eq!(found, delay, "{name}: delay after the seek (correlation {correlation:.4})");
    let quality = snr(&after, delay.max(0) as usize + 256, target + 256, rate, 4096);
    assert!(quality.iter().all(|&db| db >= min_snr), "{name}: SNR after the seek {quality:?} dB");
}

#[test]
fn mp3_decodes_and_seeks_in_place() {
    assert_lossy("tone.mp3", 44_100, 0, 15.0);
}

#[test]
fn vorbis_decodes_and_seeks_in_place() {
    assert_lossy("tone.ogg", 44_100, 0, 15.0);
}

#[test]
fn opus_decodes_and_seeks_in_place() {
    assert_lossy("tone.opus", 48_000, 0, 15.0);
}

/// AAC's edit list removes both encoder delay and trailing padding.
#[test]
fn aac_decodes_and_seeks_in_place() {
    assert_lossy("tone.m4a", 44_100, 0, 15.0);
}

fn assert_he_aac(name: &str, golden: &[u8]) {
    let mut decoder = Decoder::open(&fixture(name)).expect("opens");
    assert_eq!(decoder.sample_rate(), 48_000, "{name}: output runs at the SBR rate");
    assert_eq!(decoder.source_channels(), 2, "{name}: stereo output");
    assert_eq!(decoder.duration_frames(), Some(48_000), "{name}: trimmed duration");
    let pcm = decode_all(&mut decoder);
    assert_eq!(pcm.len(), 96_000, "{name}: frame count");

    // FFmpeg's AAC decoder produced this window, including energy above the core's 12 kHz limit.
    // Allow two 16-bit quantization steps for rounding and differences in SBR synthesis.
    let compare = |samples: &[f32], position: &str| {
        assert_eq!(samples.len() * 4, golden.len());
        for (i, (&sample, bytes)) in samples.iter().zip(golden.as_chunks::<4>().0).enumerate() {
            let expected = f32::from_le_bytes(*bytes);
            assert!(
                (sample - expected).abs() <= 2.0 / 32768.0,
                "{name} {position}: sample {i}: {sample} against {expected}"
            );
        }
    };
    let start = 12_000;
    let frames = golden.len() / 8;
    compare(&pcm[start * 2..(start + frames) * 2], "from the start");
    decoder.seek(start as u64).expect("seeks");
    compare(&decode_frames(&mut decoder, frames), "after seeking");
}

#[test]
fn he_aac_v1_in_m4a_decodes_spectral_band_replication() {
    assert_he_aac("tone-he-aac-v1.m4a", include_bytes!("fixtures/tone-he-aac-v1.f32le"));
}

#[test]
fn he_aac_v2_in_m4a_decodes_parametric_stereo() {
    assert_he_aac("tone-he-aac-v2.m4a", include_bytes!("fixtures/tone-he-aac-v2.f32le"));
}

#[test]
fn a_file_that_is_not_audio_is_refused() {
    assert!(Decoder::open(&fixture("make.py")).is_err());
}

#[test]
fn a_missing_file_is_refused() {
    assert!(Decoder::open(&fixture("missing.flac")).is_err());
}

#[test]
fn itunes_only_aac_trims_and_seeks_without_an_edit_list() {
    assert_lossy("tone-smpb.m4a", 44_100, 0, 15.0);
}
