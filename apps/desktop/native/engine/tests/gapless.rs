mod common;
use common::fixture;
use std::time::Duration;
use wave_audio::player::{PlayState, Player};

#[test]
fn preloaded_aac_crosses_the_trimmed_boundary_without_a_silent_frame() {
    let player = Player::new();
    player.load(&fixture("tone.m4a")).unwrap();
    player.preload(Some((&fixture("tone.m4a"), "next".into()))).unwrap();
    player.seek(44_100 - 128).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    player.play().unwrap();
    let mut out = [0.0; 512];
    player.render(&mut out, 44_100);
    assert_eq!(player.progress().state, PlayState::Playing);
    assert_eq!(player.progress().position_frames, 128);
    let expected = include_bytes!("fixtures/aac-boundary.f32le");
    let golden: Vec<f32> =
        expected.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
    assert_eq!(out.as_slice(), golden.as_slice());
    assert_eq!(player.take_transitions()[0].key, "next");
}

#[test]
fn a_next_song_at_another_rate_waits_in_silence_for_a_stream_at_its_rate() {
    let player = Player::new();
    player.load(&fixture("tone.m4a")).unwrap();
    player.preload(Some((&fixture("tone.flac"), "next".into()))).unwrap();
    player.seek(44_100 - 128).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    player.play().unwrap();
    let mut out = [1.0; 512];
    player.render(&mut out, 44_100);
    assert_eq!(player.take_transitions()[0].key, "next");
    assert!(out[256..].iter().all(|&s| s == 0.0), "the 22,050 Hz song never plays at 44,100 Hz");
    assert_eq!(player.progress().position_frames, 0);

    player.render(&mut out, 44_100);
    assert!(out.iter().all(|&s| s == 0.0));
    assert_eq!(player.progress().position_frames, 0, "a stream at the old rate holds the song");

    player.render(&mut out, 22_050);
    assert_eq!(player.progress().position_frames, 256, "a stream at its rate plays it");
    assert_eq!(player.progress().state, PlayState::Playing);
}
