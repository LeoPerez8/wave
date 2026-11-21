//! Normalize Volume's meter against EBU Tech 3341's reference signals, written as WAV files and
//! measured through the file, as a Library song is.

mod common;

use std::f64::consts::PI;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use common::fixture;
use wave_audio::loudness::{Measurement, measure};

/// Within this many LU of the reference, as EBU Tech 3341 asks.
const TOLERANCE: f64 = 0.1;

/// A 1 kHz sine at `dbfs` for `seconds`, as EBU Tech 3341 builds its cases.
fn tone(dbfs: f64, seconds: f64, rate: u32) -> Vec<f32> {
    let amplitude = 10f64.powf(dbfs / 20.0);
    let frames = (seconds * rate as f64).round() as usize;
    (0..frames)
        .map(|n| (amplitude * (2.0 * PI * 1000.0 * n as f64 / rate as f64).sin()) as f32)
        .collect()
}

/// Writes `frames` (one sample per frame, repeated on each of `channels`) as a 32-bit float WAV.
fn wav(name: &str, frames: &[f32], channels: u16, rate: u32) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("wave-loudness-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("makes the folder");
    let path = dir.join(name);
    let data_bytes = (frames.len() * channels as usize * 4) as u32;
    let mut bytes = Vec::with_capacity(data_bytes as usize + 44);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&3u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * channels as u32 * 4).to_le_bytes());
    bytes.extend_from_slice(&(channels * 4).to_le_bytes());
    bytes.extend_from_slice(&32u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_bytes.to_le_bytes());
    for &sample in frames {
        for _ in 0..channels {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
    }
    fs::write(&path, bytes).expect("writes the file");
    path
}

fn loudness_of(path: &PathBuf) -> (f64, f64) {
    let result = measure(path, &AtomicBool::new(false));
    let _ = fs::remove_file(path);
    match result {
        Measurement::Measured { loudness, peak } => (loudness, peak),
        other => panic!("not measured: {other:?}"),
    }
}

fn assert_lufs(name: &str, parts: &[(f64, f64)], channels: u16, rate: u32, expected: f64) {
    let signal: Vec<f32> = parts.iter().flat_map(|&(db, s)| tone(db, s, rate)).collect();
    let (loudness, _) = loudness_of(&wav(name, &signal, channels, rate));
    assert!((loudness - expected).abs() <= TOLERANCE, "{name}: {loudness:.3} LUFS, not {expected}");
}

#[test]
fn ebu_3341_case_1_a_stereo_sine_at_minus_23_dbfs_reads_minus_23_lufs() {
    assert_lufs("case1.wav", &[(-23.0, 20.0)], 2, 48_000, -23.0);
}

#[test]
fn ebu_3341_case_2_a_stereo_sine_at_minus_33_dbfs_reads_minus_33_lufs() {
    assert_lufs("case2.wav", &[(-33.0, 20.0)], 2, 48_000, -33.0);
}

#[test]
fn ebu_3341_case_3_the_relative_gate_leaves_out_the_quiet_ends() {
    assert_lufs("case3.wav", &[(-36.0, 10.0), (-23.0, 60.0), (-36.0, 10.0)], 2, 48_000, -23.0);
}

#[test]
fn ebu_3341_case_4_the_absolute_gate_leaves_out_near_silence() {
    let parts = [(-72.0, 10.0), (-36.0, 10.0), (-23.0, 60.0), (-36.0, 10.0), (-72.0, 10.0)];
    assert_lufs("case4.wav", &parts, 2, 48_000, -23.0);
}

#[test]
fn ebu_3341_case_5_louder_middle_averages_to_minus_23() {
    assert_lufs("case5.wav", &[(-26.0, 20.0), (-20.0, 20.1), (-26.0, 20.0)], 2, 48_000, -23.0);
}

#[test]
fn the_k_weighting_holds_at_other_sample_rates() {
    assert_lufs("rate44.wav", &[(-23.0, 20.0)], 2, 44_100, -23.0);
    assert_lufs("rate96.wav", &[(-23.0, 20.0)], 2, 96_000, -23.0);
}

#[test]
fn a_mono_file_counts_one_channel_as_the_phone_does() {
    assert_lufs("mono.wav", &[(-23.0, 20.0)], 1, 48_000, -26.0);
}

#[test]
fn the_peak_is_the_largest_sample_on_a_full_scale() {
    let (_, peak) = loudness_of(&wav("peak.wav", &tone(-6.0, 5.0, 48_000), 2, 48_000));
    assert!((peak - 10f64.powf(-6.0 / 20.0)).abs() < 1e-4, "peak {peak}");
}

#[test]
fn silence_and_a_file_that_is_not_audio_are_unmeasurable() {
    let silence = wav("silence.wav", &vec![0.0; 48_000 * 3], 2, 48_000);
    assert!(matches!(measure(&silence, &AtomicBool::new(false)), Measurement::Unmeasurable));
    let _ = fs::remove_file(&silence);
    let text = std::env::temp_dir().join(format!("wave-not-audio-{}.mp3", std::process::id()));
    fs::write(&text, b"not audio at all").unwrap();
    assert!(matches!(measure(&text, &AtomicBool::new(false)), Measurement::Unmeasurable));
    let _ = fs::remove_file(&text);
}

#[test]
fn a_missing_file_is_unreadable_and_a_cancelled_one_says_so() {
    assert!(matches!(
        measure(&fixture("missing.flac"), &AtomicBool::new(false)),
        Measurement::Unreadable
    ));
    let cancelled = AtomicBool::new(false);
    cancelled.store(true, Ordering::SeqCst);
    assert!(matches!(measure(&fixture("tone.flac"), &cancelled), Measurement::Cancelled));
}

/// The fixtures hold one second of one signal in every format. The lossless and the trimmed lossy
/// ones read alike, within EBU's tolerance; the MP3 decodes with its encoder's padding after the
/// signal, so its last blocks are partly silent and it reads a little quieter.
#[test]
fn every_format_reads_the_fixture_signal_alike() {
    let read = |name: &str| match measure(&fixture(name), &AtomicBool::new(false)) {
        Measurement::Measured { loudness, peak } => (loudness, peak),
        other => panic!("{name}: {other:?}"),
    };
    let (reference, _) = read("tone.wav");
    for name in ["tone.flac", "tone.m4a", "tone.ogg", "tone.opus", "tone-alac.m4a"] {
        let (loudness, peak) = read(name);
        assert!(peak > 0.45 && peak <= 0.6, "{name}: peak {peak}");
        assert!(
            (loudness - reference).abs() <= TOLERANCE,
            "{name}: {loudness:.3} LUFS against {reference:.3}"
        );
    }
    let (mp3, _) = read("tone.mp3");
    assert!(mp3 < reference && mp3 > reference - 1.0, "tone.mp3: {mp3:.3} against {reference:.3}");
}

#[test]
fn he_aac_loudness_and_peak_match_the_reference_decoder() {
    for (name, expected_lufs, peak_dbfs) in
        [("tone-he-aac-v1.m4a", -11.6, -5.9), ("tone-he-aac-v2.m4a", -11.5, -4.0)]
    {
        // FFmpeg's ebur128 filter and sample peak on the same fixtures.
        let result = measure(&fixture(name), &AtomicBool::new(false));
        let Measurement::Measured { loudness, peak } = result else {
            panic!("{name}: {result:?}");
        };
        assert!((loudness - expected_lufs).abs() <= 0.2, "{name}: {loudness:.3} LUFS");
        let peak_db = 20.0 * peak.log10();
        assert!((peak_db - peak_dbfs).abs() <= 0.2, "{name}: peak {peak_db:.3} dBFS");
    }
}
