//! Regenerate the boundary golden independently of Wave's Decoder and Player.
//! Fixture source is exactly 44,100 frames; ffmpeg AAC adds 1,024 priming frames.
use std::{fs::File, io::Write, path::Path};
use symphonia::core::{
    codecs::audio::AudioDecoderOptions,
    formats::{FormatOptions, TrackType, probe::Hint},
    io::MediaSourceStream,
    meta::MetadataOptions,
};
fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let stream = MediaSourceStream::new(
        Box::new(File::open(root.join("tone.m4a")).unwrap()),
        Default::default(),
    );
    let mut hint = Hint::new();
    hint.with_extension("m4a");
    let mut format = symphonia::default::get_probe()
        .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
        .unwrap();
    let track = format.default_track(TrackType::Audio).unwrap();
    let id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(
            track.codec_params.as_ref().unwrap().audio().unwrap(),
            &AudioDecoderOptions::default(),
        )
        .unwrap();
    let mut pcm = vec![];
    while let Ok(Some(packet)) = format.next_packet() {
        if packet.track_id != id {
            continue;
        }
        let buffer = decoder.decode(&packet).unwrap();
        let mut samples: Vec<f32> = vec![];
        buffer.copy_to_vec_interleaved(&mut samples);
        pcm.extend(samples);
    }
    let song = &pcm[1024 * 2..(1024 + 44100) * 2];
    let mut out = File::create(root.join("aac-boundary.f32le")).unwrap();
    for sample in song[song.len() - 256..].iter().chain(&song[..256]) {
        out.write_all(&sample.to_le_bytes()).unwrap();
    }
}
