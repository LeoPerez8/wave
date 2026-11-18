//! Normalize Volume's meter (docs/spec.md › Normalize Volume): a song's integrated loudness by
//! ITU-R BS.1770 (K-weighting, 400 ms blocks overlapping by 75 %, an absolute gate at -70 LUFS
//! and a relative one 10 LU under the blocks above it) and its sample peak. A port of the phone's
//! `LoudnessMeter.kt`, checked against the same EBU Tech 3341 cases (`tests/loudness.rs`).

use std::f64::consts::PI;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::decode::Decoder;
use crate::error::EngineError;

const ABSOLUTE_GATE_LUFS: f64 = -70.0;
const RELATIVE_GATE_LU: f64 = 10.0;
// libebur128's K-weighting design, which gives BS.1770's own coefficients at 48 kHz.
const SHELF_HZ: f64 = 1681.974450955533;
const SHELF_GAIN_DB: f64 = 3.999843853973347;
const SHELF_Q: f64 = 0.7071752369554196;
const SHELF_VB_EXPONENT: f64 = 0.4996667741545416;
const HIGH_PASS_HZ: f64 = 38.13547087602444;
const HIGH_PASS_Q: f64 = 0.5003270373238773;

/// What measuring a file gave, as the phone's meter says it (`AudioMeasurement` in JS).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Measurement {
    /// Integrated loudness in LUFS, and the sample peak on a 0–1 scale.
    Measured { loudness: f64, peak: f64 },
    /// It couldn't be decoded, or holds nothing above the absolute gate (silence).
    Unmeasurable,
    /// It couldn't be opened now: gone, or on a drive that isn't connected.
    Unreadable,
    /// Normalize Volume turned off while it was being measured.
    Cancelled,
}

impl Measurement {
    pub fn kind(&self) -> &'static str {
        match self {
            Measurement::Measured { .. } => "measured",
            Measurement::Unmeasurable => "unmeasurable",
            Measurement::Unreadable => "unreadable",
            Measurement::Cancelled => "cancelled",
        }
    }
}

/// Decodes the file at `path` from its start and measures what plays: the front pair of a file
/// with more than two channels (the engine plays only those), and a mono file as one channel, as
/// the phone counts it. Stops early, `Cancelled`, once `cancelled` is set.
pub fn measure(path: &Path, cancelled: &AtomicBool) -> Measurement {
    if cancelled.load(Ordering::Relaxed) {
        return Measurement::Cancelled;
    }
    let mut decoder = match Decoder::open(path) {
        Ok(decoder) => decoder,
        Err(EngineError::NotFound(_)) => return Measurement::Unreadable,
        Err(_) => return Measurement::Unmeasurable,
    };
    let mono = decoder.source_channels() == 1;
    let mut meter = LoudnessMeter::new(decoder.sample_rate(), if mono { 1 } else { 2 });
    let mut left = Vec::new();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Measurement::Cancelled;
        }
        match decoder.next_chunk() {
            Ok(Some(chunk)) if mono => {
                left.clear();
                left.extend(chunk.iter().step_by(2));
                meter.add(&left);
            }
            Ok(Some(chunk)) => meter.add(&chunk),
            Ok(None) => break,
            Err(_) => return Measurement::Unmeasurable,
        }
    }
    match meter.result() {
        Some((loudness, peak)) => Measurement::Measured { loudness, peak },
        None => Measurement::Unmeasurable,
    }
}

/// BS.1770 loudness from interleaved samples as they stream by ([add](LoudnessMeter::add)).
pub struct LoudnessMeter {
    channels: usize,
    filters: Vec<KWeighting>,
    /// A 100 ms step: four make a 400 ms block, and each step starts the next block.
    step_frames: usize,
    step_frames_so_far: usize,
    step_energy: f64,
    last_steps: [f64; 4],
    steps: usize,
    /// The mean-square energy of every block above the absolute gate.
    blocks: Vec<f64>,
    peak: f64,
    /// Where the next sample of `add` falls in its frame.
    channel: usize,
}

impl LoudnessMeter {
    /// A meter for `channels` (1 or 2, each weighted 1) at `rate`.
    pub fn new(rate: u32, channels: usize) -> LoudnessMeter {
        let channels = channels.max(1);
        LoudnessMeter {
            channels,
            filters: (0..channels).map(|_| KWeighting::new(rate)).collect(),
            step_frames: (rate as usize / 10).max(1),
            step_frames_so_far: 0,
            step_energy: 0.0,
            last_steps: [0.0; 4],
            steps: 0,
            blocks: Vec::new(),
            peak: 0.0,
            channel: 0,
        }
    }

    /// Takes interleaved samples; a frame may run over into the next call.
    pub fn add(&mut self, samples: &[f32]) {
        for &sample in samples {
            let sample = sample as f64;
            self.peak = self.peak.max(sample.abs());
            let weighted = self.filters[self.channel].process(sample);
            self.step_energy += weighted * weighted;
            self.channel += 1;
            if self.channel == self.channels {
                self.channel = 0;
                self.step_frames_so_far += 1;
                if self.step_frames_so_far == self.step_frames {
                    self.finish_step();
                }
            }
        }
    }

    /// The integrated loudness and the peak (at most 1) of everything added; `None` when nothing
    /// was above the absolute gate.
    pub fn result(&self) -> Option<(f64, f64)> {
        if self.blocks.is_empty() {
            return None;
        }
        let relative_gate = loudness(mean(self.blocks.iter().copied())) - RELATIVE_GATE_LU;
        let gated = mean(self.blocks.iter().copied().filter(|&b| loudness(b) > relative_gate));
        Some((loudness(gated), self.peak.min(1.0)))
    }

    fn finish_step(&mut self) {
        self.last_steps[self.steps % 4] = self.step_energy;
        self.steps += 1;
        self.step_energy = 0.0;
        self.step_frames_so_far = 0;
        if self.steps < 4 {
            return;
        }
        let block = self.last_steps.iter().sum::<f64>() / (4.0 * self.step_frames as f64);
        if loudness(block) > ABSOLUTE_GATE_LUFS {
            self.blocks.push(block);
        }
    }
}

fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let (sum, count) = values.fold((0.0, 0usize), |(sum, count), v| (sum + v, count + 1));
    sum / count as f64
}

/// A mean-square energy as BS.1770 loudness.
fn loudness(energy: f64) -> f64 {
    -0.691 + 10.0 * energy.log10()
}

/// K-weighting as two biquads, for any sample rate: a +4 dB shelf above about 1.7 kHz, then the
/// RLB high-pass at about 38 Hz.
struct KWeighting {
    shelf: Biquad,
    high_pass: Biquad,
}

impl KWeighting {
    fn new(rate: u32) -> KWeighting {
        let rate = rate as f64;
        let k = (PI * SHELF_HZ / rate).tan();
        let vh = 10f64.powf(SHELF_GAIN_DB / 20.0);
        let vb = vh.powf(SHELF_VB_EXPONENT);
        let a0 = 1.0 + k / SHELF_Q + k * k;
        let shelf = Biquad::new(
            (vh + vb * k / SHELF_Q + k * k) / a0,
            2.0 * (k * k - vh) / a0,
            (vh - vb * k / SHELF_Q + k * k) / a0,
            2.0 * (k * k - 1.0) / a0,
            (1.0 - k / SHELF_Q + k * k) / a0,
        );
        let k = (PI * HIGH_PASS_HZ / rate).tan();
        let d = 1.0 + k / HIGH_PASS_Q + k * k;
        let high_pass = Biquad::new(
            1.0,
            -2.0,
            1.0,
            2.0 * (k * k - 1.0) / d,
            (1.0 - k / HIGH_PASS_Q + k * k) / d,
        );
        KWeighting { shelf, high_pass }
    }

    fn process(&mut self, sample: f64) -> f64 {
        let shelved = self.shelf.process(sample);
        self.high_pass.process(shelved)
    }
}

struct Biquad {
    b: [f64; 3],
    a: [f64; 2],
    x: [f64; 2],
    y: [f64; 2],
}

impl Biquad {
    fn new(b0: f64, b1: f64, b2: f64, a1: f64, a2: f64) -> Biquad {
        Biquad { b: [b0, b1, b2], a: [a1, a2], x: [0.0; 2], y: [0.0; 2] }
    }

    fn process(&mut self, x: f64) -> f64 {
        let y = self.b[0] * x + self.b[1] * self.x[0] + self.b[2] * self.x[1]
            - self.a[0] * self.y[0]
            - self.a[1] * self.y[1];
        self.x = [x, self.x[0]];
        self.y = [y, self.y[0]];
        y
    }
}
