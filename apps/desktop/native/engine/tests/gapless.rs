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
    player.render(&mut out);
    assert_eq!(player.progress().state, PlayState::Playing);
    assert_eq!(player.progress().position_frames, 128);
    let expected = include_bytes!("fixtures/aac-boundary.f32le");
    let golden: Vec<f32> =
        expected.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
    assert_eq!(out.as_slice(), golden.as_slice());
    assert_eq!(player.take_transitions()[0].key, "next");
}
