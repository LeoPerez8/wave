//! One file, decoded to interleaved stereo `f32` frames at the file's own rate.

use std::path::Path;
use std::sync::OnceLock;

use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::codecs::registry::CodecRegistry;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, RawValue};
use symphonia::core::packet::Packet;
use symphonia::core::units::{TimeBase, Timestamp};
use symphonia_adapter_libopus::OpusDecoder;

use crate::error::EngineError;
use crate::he_aac::HeAac;
use crate::stream::Origin;

/// Symphonia's codecs plus Opus through libopus.
fn codecs() -> &'static CodecRegistry {
    static CODECS: OnceLock<CodecRegistry> = OnceLock::new();
    CODECS.get_or_init(|| {
        let mut registry = CodecRegistry::new();
        symphonia::default::register_enabled_codecs(&mut registry);
        registry.register_audio_decoder::<OpusDecoder>();
        registry
    })
}

/// How far before a seek target decoding starts, so lossy decoders settle first. Opus asks for
/// 80 ms; AAC and Vorbis need one packet's overlap.
const PREROLL_SECONDS: f64 = 0.1;

enum PacketDecoder {
    Standard(Box<dyn AudioDecoder>),
    HeAac(Box<HeAac>),
}

pub struct Decoder {
    /// Where the song is read from, to open it again.
    source: Origin,
    /// The demuxer has run out; Symphonia's MP4 reader can't seek after that.
    at_end: bool,
    format: Box<dyn FormatReader>,
    decoder: PacketDecoder,
    track_id: u32,
    rate: u32,
    time_base: Option<TimeBase>,
    duration: Option<u64>,
    /// Where frame 0 of the song sits on the track's timeline, in frames. Most demuxers put it
    /// at 0; Opus counts the pre-skip its decoder drops.
    origin: i64,
    /// Frames before this one are dropped, so a seek lands on the exact frame asked for.
    drop_before: u64,
    /// The first chunk, decoded at open to find `origin`.
    pending: Option<Vec<f32>>,
    scratch: Vec<f32>,
    /// How many channels the file has; the chunks are stereo whatever it is.
    channels: usize,
}

/// Decoded stereo audio and where it starts on the track's timeline, in frames.
struct Chunk {
    first_frame: i64,
    samples: Vec<f32>,
}

impl Decoder {
    pub fn open(path: &Path) -> Result<Decoder, EngineError> {
        Decoder::open_origin(&Origin::File(path.to_path_buf()))
    }

    pub fn open_origin(source: &Origin) -> Result<Decoder, EngineError> {
        let media = source.source().map_err(|e| EngineError::NotFound(e.to_string()))?;
        let length = media.byte_len();
        let extension = source.extension();
        let mut hint = Hint::new();
        if let Some(extension) = &extension {
            hint.with_extension(extension);
        }
        let stream = MediaSourceStream::new(media, Default::default());
        let mut format = symphonia::default::get_probe()
            .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
            .map_err(|e| EngineError::Unsupported(e.to_string()))?;
        let track = format
            .default_track(TrackType::Audio)
            .ok_or_else(|| EngineError::Unsupported("no audio track".into()))?;
        let params = track
            .codec_params
            .as_ref()
            .and_then(|p| p.audio())
            .ok_or_else(|| EngineError::Unsupported("no audio codec".into()))?
            .clone();
        let track_id = track.id;
        let mut time_base = track.time_base;
        let duration_ticks = track.duration;
        let mut num_frames = track.num_frames;
        let mut rate =
            params.sample_rate.ok_or_else(|| EngineError::Unsupported("no sample rate".into()))?;
        let mut smpb_scale = 1;
        let mut first_packet = None;
        let mut he_aac = HeAac::candidate(&params);
        if let Some(candidate) = &mut he_aac
            && candidate.output_rate.is_none()
        {
            first_packet = next_audio_packet(&mut *format, track_id)?;
            if let Some(packet) = &first_packet {
                candidate.probe(&packet.data);
            }
        }
        let decoder = if let Some(he_aac) = he_aac
            && let Some(output_rate) = he_aac.output_rate
        {
            rate = output_rate;
            smpb_scale = u64::from(rate / he_aac.core_rate);
            // ADTS packets count core frames. MP4 supplies the track timescale.
            time_base = time_base.or_else(|| TimeBase::try_from_recip(he_aac.core_rate));
            num_frames = duration_ticks
                .map(|ticks| ticks_to_frames(ticks.get() as i64, time_base, rate).max(0) as u64);
            PacketDecoder::HeAac(Box::new(he_aac))
        } else {
            PacketDecoder::Standard(
                codecs()
                    .make_audio_decoder(&params, &AudioDecoderOptions::default())
                    .map_err(|e| EngineError::Unsupported(e.to_string()))?,
            )
        };

        let trim = if extension
            .as_deref()
            .is_some_and(|s| s.eq_ignore_ascii_case("m4a") || s.eq_ignore_ascii_case("mp4"))
        {
            format
                .metadata()
                .current()
                .and_then(|rev| {
                    rev.media.tags.iter().find_map(|tag| {
                        if !tag.raw.key.contains("iTunSMPB") {
                            return None;
                        }
                        match &tag.raw.value {
                            RawValue::String(s) => crate::gapless::smpb(s, num_frames, smpb_scale),
                            RawValue::Binary(b) => crate::gapless::smpb(
                                &String::from_utf8_lossy(b),
                                num_frames,
                                smpb_scale,
                            ),
                            _ => None,
                        }
                    })
                })
                .or_else(|| {
                    let reader = source.source().ok()?;
                    crate::gapless::from_mp4_reader(reader, length?, track_id, rate)
                })
        } else {
            None
        };

        let mut decoder = Decoder {
            source: source.clone(),
            at_end: false,
            track_id,
            time_base,
            format,
            decoder,
            rate,
            duration: None,
            origin: 0,
            drop_before: 0,
            pending: None,
            scratch: Vec::new(),
            channels: 2,
        };
        let first = decoder
            .decode_next(first_packet)?
            .ok_or_else(|| EngineError::Unsupported("no audio in the file".into()))?;
        decoder.origin = first.first_frame;
        // Demuxers count delay and padding out of `num_frames`, except that Opus counts its
        // pre-skip in; the timeline's origin covers both.
        decoder.duration =
            num_frames.map(|frames| frames.saturating_sub(first.first_frame.max(0) as u64));
        if let Some(trim) = trim {
            decoder.origin += trim.delay as i64;
            decoder.duration = Some(trim.frames);
        }
        decoder.pending = decoder.trim_chunk(first);
        Ok(decoder)
    }

    pub fn sample_rate(&self) -> u32 {
        self.rate
    }

    /// How many channels the file holds: 1 for mono, whose chunks repeat it on both sides.
    pub fn source_channels(&self) -> usize {
        self.channels
    }

    /// The song's length in frames, when the file says.
    pub fn duration_frames(&self) -> Option<u64> {
        self.duration
    }

    /// The next decoded frames, interleaved stereo; `None` at the end of the file.
    pub fn next_chunk(&mut self) -> Result<Option<Vec<f32>>, EngineError> {
        if let Some(samples) = self.pending.take() {
            return Ok(Some(samples));
        }
        loop {
            let Some(chunk) = self.decode_next(None)? else {
                return Ok(None);
            };
            if let Some(samples) = self.trim_chunk(chunk) {
                return Ok(Some(samples));
            }
        }
    }

    fn trim_chunk(&mut self, chunk: Chunk) -> Option<Vec<f32>> {
        let first = chunk.first_frame - self.origin;
        let frames = (chunk.samples.len() / 2) as i64;
        let drop = (self.drop_before as i64 - first).clamp(0, frames) as usize;
        let end =
            self.duration.map_or(frames, |duration| (duration as i64 - first).clamp(0, frames))
                as usize;
        if end <= drop {
            return None;
        }
        self.drop_before = 0;
        Some(chunk.samples[drop * 2..end * 2].to_vec())
    }

    /// Moves to `frame`, so the next chunk starts exactly there.
    pub fn seek(&mut self, frame: u64) -> Result<(), EngineError> {
        if self.at_end {
            *self = Decoder::open_origin(&self.source.clone())?;
        }
        // HE-AAC also needs to settle the SBR filterbanks and Parametric Stereo history.
        let from = match self.decoder {
            PacketDecoder::HeAac(_) => (self.origin + frame as i64 - i64::from(self.rate)).max(0),
            _ => {
                let preroll = (self.rate as f64 * PREROLL_SECONDS) as u64;
                frame.saturating_sub(preroll) as i64 + self.origin
            }
        };
        let ts = self.frames_to_ticks(from.max(0));
        self.format
            .seek(SeekMode::Accurate, SeekTo::Timestamp { ts, track_id: self.track_id })
            .map_err(|e| EngineError::Decode(e.to_string()))?;
        match &mut self.decoder {
            PacketDecoder::Standard(decoder) => decoder.reset(),
            PacketDecoder::HeAac(decoder) if from <= 0 => decoder.reset(),
            // Keep the SBR header between seeks. A later packet can refer to it without
            // repeating it, and the preroll replaces the audio history before playback.
            PacketDecoder::HeAac(_) => {}
        }
        self.pending = None;
        self.drop_before = frame;
        Ok(())
    }

    /// The next packet's audio, placed on the track's timeline. A packet can give fewer frames
    /// than it lasts (trimmed, or priming the decoder after a seek), so its place is measured
    /// back from where it ends.
    fn decode_next(
        &mut self,
        mut first_packet: Option<Packet>,
    ) -> Result<Option<Chunk>, EngineError> {
        loop {
            let packet = match first_packet.take() {
                Some(packet) => Some(packet),
                None => next_audio_packet(&mut *self.format, self.track_id)?,
            };
            let Some(packet) = packet else {
                self.at_end = true;
                return Ok(None);
            };
            self.scratch.clear();
            let channels = match &mut self.decoder {
                PacketDecoder::Standard(decoder) => {
                    let buffer = match decoder.decode(&packet) {
                        Ok(buffer) => buffer,
                        // A damaged packet is skipped, as players do.
                        Err(SymphoniaError::DecodeError(_)) => continue,
                        Err(e) => return Err(EngineError::Decode(e.to_string())),
                    };
                    buffer.copy_to_vec_interleaved(&mut self.scratch);
                    buffer.spec().channels().count().max(1)
                }
                PacketDecoder::HeAac(decoder) => {
                    let frame = decoder
                        .decode(&packet.data)
                        .map_err(|e| EngineError::Decode(e.to_string()))?;
                    if frame.pcm.is_empty() {
                        continue;
                    }
                    if frame.sample_rate != self.rate {
                        return Err(EngineError::Decode(
                            "HE-AAC output sample rate changed".into(),
                        ));
                    }
                    self.scratch.extend(frame.pcm.into_iter().map(|s| f32::from(s) / 32768.0));
                    frame.channels
                }
            };
            if self.scratch.is_empty() {
                continue;
            }
            self.channels = channels;
            let frames = (self.scratch.len() / channels) as i64;
            let end = packet.pts.get() + packet.dur.get() as i64 - packet.trim_end.get() as i64;
            return Ok(Some(Chunk {
                first_frame: ticks_to_frames(end, self.time_base, self.rate) - frames,
                samples: to_stereo(&self.scratch, channels),
            }));
        }
    }

    fn frames_to_ticks(&self, frames: i64) -> Timestamp {
        match self.time_base {
            Some(base) if !is_per_frame(base, self.rate) => {
                let seconds = frames as f64 / self.rate as f64;
                let ticks = seconds * base.denom.get() as f64 / base.numer.get() as f64;
                Timestamp::new(ticks.round() as i64)
            }
            _ => Timestamp::new(frames),
        }
    }
}

fn next_audio_packet(
    format: &mut dyn FormatReader,
    track_id: u32,
) -> Result<Option<Packet>, EngineError> {
    loop {
        match format.next_packet() {
            Ok(Some(packet)) if packet.track_id != track_id => continue,
            Ok(packet) => return Ok(packet),
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Ok(None);
            }
            Err(e) => return Err(EngineError::Decode(e.to_string())),
        }
    }
}

fn ticks_to_frames(ticks: i64, time_base: Option<TimeBase>, rate: u32) -> i64 {
    match time_base {
        Some(base) if !is_per_frame(base, rate) => {
            let seconds = ticks as f64 * base.numer.get() as f64 / base.denom.get() as f64;
            (seconds * rate as f64).round() as i64
        }
        _ => ticks,
    }
}

fn is_per_frame(base: TimeBase, rate: u32) -> bool {
    base.numer.get() == 1 && base.denom.get() == rate
}

/// Mono plays on both sides; more than two channels keep the front pair.
fn to_stereo(interleaved: &[f32], channels: usize) -> Vec<f32> {
    match channels {
        2 => interleaved.to_vec(),
        1 => interleaved.iter().flat_map(|&s| [s, s]).collect(),
        _ => interleaved.chunks(channels).flat_map(|f| [f[0], f[1]]).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::to_stereo;

    #[test]
    fn mono_plays_on_both_sides() {
        assert_eq!(to_stereo(&[0.1, 0.2], 1), vec![0.1, 0.1, 0.2, 0.2]);
    }

    #[test]
    fn surround_keeps_the_front_pair() {
        assert_eq!(to_stereo(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0], 3), vec![1.0, 2.0, 4.0, 5.0]);
    }
}
