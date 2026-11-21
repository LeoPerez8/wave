//! Reads a PCM WAV file (16-bit, any rate and channel count) the way
//! shazamio-core's `MonoDecoder` hands it to the resampler: samples as `f32` in
//! [-1, 1) (`symphonia` divides by 32768) and channels averaged into one.

use std::error::Error;
use std::path::Path;

pub struct Spec {
    rate: u32,
}

impl Spec {
    pub fn rate(&self) -> u32 {
        self.rate
    }
}

pub struct MonoDecoder {
    spec: Spec,
    frames: Option<Vec<f32>>,
}

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

impl MonoDecoder {
    pub fn from_file(file_path: &Path) -> Result<Self, Box<dyn Error>> {
        MonoDecoder::from_bytes(std::fs::read(file_path)?)
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, Box<dyn Error>> {
        if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
            return Err("not a WAV file".into());
        }
        let (mut channels, mut rate, mut bits, mut data) = (0usize, 0u32, 0u16, None);
        let mut offset = 12;
        while offset + 8 <= bytes.len() {
            let id = &bytes[offset..offset + 4];
            let size = u32_at(&bytes, offset + 4) as usize;
            let body = offset + 8;
            if id == b"fmt " {
                if u16_at(&bytes, body) != 1 {
                    return Err("only integer PCM WAV files".into());
                }
                channels = u16_at(&bytes, body + 2) as usize;
                rate = u32_at(&bytes, body + 4);
                bits = u16_at(&bytes, body + 14);
            } else if id == b"data" {
                data = Some(&bytes[body..body + size]);
            }
            offset = body + size + (size & 1);
        }
        let data = data.ok_or("no data chunk")?;
        if bits != 16 || channels == 0 {
            return Err("only 16-bit WAV files".into());
        }
        let mut frames = vec![0f32; data.len() / 2 / channels];
        for (index, pair) in data.chunks_exact(2).enumerate() {
            let sample = i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32768.0;
            frames[index / channels] += sample / channels as f32;
        }
        Ok(MonoDecoder { spec: Spec { rate }, frames: Some(frames) })
    }

    pub fn spec(&self) -> &Spec {
        &self.spec
    }

    pub fn next_chunk(&mut self, mono_frames: &mut Vec<f32>) -> Result<bool, Box<dyn Error>> {
        match self.frames.take() {
            Some(frames) => {
                *mono_frames = frames;
                Ok(true)
            }
            None => Ok(false),
        }
    }
}
