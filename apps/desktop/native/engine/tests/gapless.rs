mod common;
use common::{fixture, source_16bit};
use std::time::Duration;
use wave_audio::player::{Next, PlayState, Player, TransitionKind};

#[test]
fn preloaded_alac_starts_on_the_frame_after_the_previous_track_ends() {
    let rate = 22_050;
    let tone = fixture("tone-alac.m4a");
    let player = Player::new();
    player.load(&tone).unwrap();
    player.preload(Some(Next::new(&tone, "next"))).unwrap();
    player.seek(u64::from(rate) - 128).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    player.play().unwrap();
    let mut out = [0.0; 512];
    player.render(&mut out, rate);

    for (frame, pcm) in out.chunks_exact(2).enumerate() {
        let source_frame = (u64::from(rate) - 128 + frame as u64) % u64::from(rate);
        assert_eq!(pcm, source_16bit(source_frame, rate), "frame {frame}");
    }
    assert_eq!(player.progress().state, PlayState::Playing);
    assert_eq!(player.progress().position_frames, 128);
    let transitions = player.take_transitions();
    assert_eq!(transitions[0].key, "next");
    assert_eq!(transitions[0].kind, TransitionKind::Gapless);
}

#[test]
fn preloaded_aac_crosses_the_trimmed_boundary_without_a_silent_frame() {
    let player = Player::new();
    player.load(&fixture("tone.m4a")).unwrap();
    player.preload(Some(Next::new(&fixture("tone.m4a"), "next"))).unwrap();
    player.seek(44_100 - 128).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    player.play().unwrap();
    let mut out = [0.0; 512];
    player.render(&mut out, 44_100);
    assert_eq!(player.progress().state, PlayState::Playing);
    assert_eq!(player.progress().position_frames, 128);
    assert_eq!(out.as_slice(), golden().as_slice());
    let transitions = player.take_transitions();
    assert_eq!(transitions[0].key, "next");
    assert_eq!(transitions[0].kind, TransitionKind::Gapless);
}

fn golden() -> Vec<f32> {
    let expected = include_bytes!("fixtures/aac-boundary.f32le");
    expected.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect()
}

fn decibels(db: f64) -> f32 {
    10f64.powf(db / 20.0) as f32
}

/// Normalize Volume settles each song's gain as it is lined up, and the next song's gain takes
/// over on its first frame: the gapless boundary is the golden one, each side at its own gain.
#[test]
fn the_gain_switches_exactly_at_the_gapless_boundary() {
    let player = Player::new();
    player.load_entry(&fixture("tone.m4a"), Some("first".into()), Some(-6.0)).unwrap();
    let tone = fixture("tone.m4a");
    let next = Next { gain_db: Some(3.0), ..Next::new(&tone, "next") };
    player.preload(Some(next)).unwrap();
    player.seek(44_100 - 128).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    player.play().unwrap();
    let mut out = [0.0; 512];
    player.render(&mut out, 44_100);
    let golden = golden();
    let expected: Vec<f32> = golden
        .iter()
        .enumerate()
        .map(|(i, &s)| s * if i < 256 { decibels(-6.0) } else { decibels(3.0) })
        .collect();
    assert_eq!(out.as_slice(), expected.as_slice());
    assert_eq!(player.take_transitions()[0].key, "next");
}

#[test]
fn normalize_volume_off_plays_every_song_as_it_is_from_the_next_frame() {
    let player = Player::new();
    player.load_entry(&fixture("tone.m4a"), Some("first".into()), Some(-6.0)).unwrap();
    let tone = fixture("tone.m4a");
    let next = Next { gain_db: Some(3.0), ..Next::new(&tone, "next") };
    player.preload(Some(next)).unwrap();
    player.seek(44_100 - 128).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    player.set_normalize(false);
    player.play().unwrap();
    let mut out = [0.0; 512];
    player.render(&mut out, 44_100);
    assert_eq!(out.as_slice(), golden().as_slice());
}

#[test]
fn a_next_song_at_another_rate_waits_in_silence_for_a_stream_at_its_rate() {
    let player = Player::new();
    player.load(&fixture("tone.m4a")).unwrap();
    player.preload(Some(Next::new(&fixture("tone.flac"), "next"))).unwrap();
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
