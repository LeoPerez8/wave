//! The signal `fixtures/make.py` encoded, and ways to compare decoded PCM with it.
#![allow(dead_code)]

use std::f64::consts::PI;
use std::path::PathBuf;

pub fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

fn exact(n: u64, rate: u32) -> [f64; 2] {
    let t = n as f64 / rate as f64;
    let k = (3520.0f64 / 110.0).ln();
    let left = 0.5 * (2.0 * PI * 110.0 / k * ((t * k).exp() - 1.0)).sin();
    let right = 0.4 * (2.0 * PI * (200.0 * t + 300.0 * t * t)).sin();
    [left, right]
}

/// Frame `n` of the test signal at `rate`, as interleaved stereo.
pub fn source(n: u64, rate: u32) -> [f32; 2] {
    exact(n, rate).map(|s| s as f32)
}

/// The signal as a 16-bit file holds it.
pub fn source_16bit(n: u64, rate: u32) -> [f32; 2] {
    exact(n, rate).map(|s| (s * 32767.0).round() as f32 / 32768.0)
}

/// How many frames `decoded`, which should start at the signal's frame `start`, lags it, looked
/// for within ±`range` on the left channel, and how well it correlates there.
pub fn lag(decoded: &[f32], start: u64, rate: u32, range: i64) -> (i64, f64) {
    let window = 4096i64;
    let mut best = (0, f64::MIN);
    for lag in -range..=range {
        let (mut acc, mut ss, mut dd) = (0.0f64, 0.0f64, 0.0f64);
        for k in 0..window {
            let index = k + lag;
            if index < 0 || (index as usize) * 2 >= decoded.len() {
                continue;
            }
            let s = source(start + k as u64, rate)[0] as f64;
            let d = decoded[index as usize * 2] as f64;
            acc += s * d;
            ss += s * s;
            dd += d * d;
        }
        let correlation = acc / (ss.sqrt() * dd.sqrt() + 1e-12);
        if correlation > best.1 {
            best = (lag, correlation);
        }
    }
    best
}

/// Signal-to-noise ratio in dB of `decoded` against the signal from frame `start`, per channel,
/// over `frames` frames from `offset` in `decoded`.
pub fn snr(decoded: &[f32], offset: usize, start: u64, rate: u32, frames: usize) -> [f64; 2] {
    let mut out = [0.0; 2];
    for (channel, value) in out.iter_mut().enumerate() {
        let (mut signal, mut noise) = (0.0f64, 0.0f64);
        for k in 0..frames {
            let s = source(start + k as u64, rate)[channel] as f64;
            let d = decoded[(offset + k) * 2 + channel] as f64;
            signal += s * s;
            noise += (s - d) * (s - d);
        }
        *value = 10.0 * (signal / noise.max(1e-20)).log10();
    }
    out
}

/// Writes `seconds` of the test signal at `rate` as a 16-bit stereo WAV in a temp folder, so a
/// test can have a song longer than the fixtures; it decodes to `source_16bit`.
pub fn signal_wav(name: &str, seconds: f64, rate: u32) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("wave-signal-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("makes the folder");
    let path = dir.join(name);
    let frames = (seconds * rate as f64).round() as u64;
    let data_bytes = (frames * 4) as u32;
    let mut bytes = Vec::with_capacity(data_bytes as usize + 44);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 4).to_le_bytes());
    bytes.extend_from_slice(&4u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_bytes.to_le_bytes());
    for n in 0..frames {
        for sample in exact(n, rate) {
            bytes.extend_from_slice(&((sample * 32767.0).round() as i16).to_le_bytes());
        }
    }
    std::fs::write(&path, bytes).expect("writes the file");
    path
}
