//! The SBR and Parametric Stereo decoder for AAC access units from Symphonia.

use oxideav_aac::adts::ADTS_SAMPLE_RATES_HZ;
use oxideav_aac::asc::{AudioSpecificConfig, FrameLength};
use oxideav_aac::decode::{DecodedFrame, StreamDecoder};
use symphonia::core::codecs::audio::{AudioCodecParameters, well_known::CODEC_ID_AAC};

pub(crate) struct HeAac {
    decoder: StreamDecoder,
    pub(crate) core_rate: u32,
    pub(crate) output_rate: Option<u32>,
    frequency_index: u8,
    channel_config: u8,
}

impl HeAac {
    pub(crate) fn candidate(params: &AudioCodecParameters) -> Option<Self> {
        if params.codec != CODEC_ID_AAC {
            return None;
        }
        let (core_rate, channel_config, output_rate) = if let Some(extra) = &params.extra_data {
            let (config, _) = AudioSpecificConfig::parse(extra).ok()?;
            if config.aot != 2 || config.ga_body.frame_length != FrameLength::Long1024 {
                return None;
            }
            if config.trailing_sbr_probe.as_ref().is_some_and(|probe| !probe.sbr_present_flag) {
                return None;
            }
            (config.sample_rate, config.channel_configuration, config.extension_sample_rate)
        } else {
            // ADTS puts the core configuration in its frame headers and signals SBR in-band.
            let channels = params.channels.as_ref()?.count();
            let channel_config = match channels {
                1..=6 => channels as u8,
                8 => 7,
                _ => return None,
            };
            (params.sample_rate?, channel_config, None)
        };
        let frequency_index =
            ADTS_SAMPLE_RATES_HZ.iter().position(|&rate| rate == core_rate)? as u8;
        let mut candidate = Self {
            decoder: StreamDecoder::new(),
            core_rate,
            output_rate,
            frequency_index,
            channel_config,
        };
        candidate.reset();
        Some(candidate)
    }

    /// An LC AudioSpecificConfig can still carry SBR in the access units themselves.
    pub(crate) fn probe(&mut self, data: &[u8]) {
        if let Ok(frame) = self.decode(data) {
            if frame.sample_rate > self.core_rate {
                self.output_rate = Some(frame.sample_rate);
            }
        }
        self.reset();
    }

    pub(crate) fn reset(&mut self) {
        self.decoder = StreamDecoder::new();
        self.decoder.set_sbr_downsampled(self.output_rate == Some(self.core_rate));
    }

    pub(crate) fn decode(&mut self, data: &[u8]) -> oxideav_aac::Result<DecodedFrame> {
        self.decoder.decode_raw_data_block(
            2,
            self.frequency_index,
            self.core_rate,
            self.channel_config,
            1,
            data,
        )
    }
}
