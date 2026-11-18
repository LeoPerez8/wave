//! Crossfade (docs/spec.md, story 22a): a song that ends on its own fades out under the next one
//! on a second voice, by Core's rules, with equal-power curves.

mod common;

use std::f64::consts::FRAC_PI_2;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use common::{fixture, signal_wav, source_16bit};
use wave_audio::player::{Next, PlayState, Player, Transition, TransitionKind};

const RATE: u32 = 22_050;

/// A four-second song, long enough for the late rule's one second.
fn long_song() -> &'static PathBuf {
    static SONG: OnceLock<PathBuf> = OnceLock::new();
    SONG.get_or_init(|| signal_wav("long.wav", 4.0, RATE))
}

/// Pulls `frames` frames that played, skipping the silence of an empty buffer.
fn play_frames(player: &Player, frames: usize) -> Vec<f32> {
    let mut played = Vec::new();
    let mut block = [0.0f32; 256];
    let deadline = Instant::now() + Duration::from_secs(10);
    while played.len() < frames * 2 {
        let want = (frames * 2 - played.len()).min(block.len());
        let moved = player.render(&mut block[..want], RATE);
        played.extend_from_slice(&block[..moved * 2]);
        if player.progress().state != PlayState::Playing {
            break;
        }
        assert!(Instant::now() < deadline, "the buffer never filled");
        if moved == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    played
}

/// What the mix of the incoming frame `incoming` and the outgoing frame `outgoing` is, `done`
/// frames into an overlap of `overlap`, both songs at `gain_in` and `gain_out`.
fn mixed(incoming: u64, outgoing: u64, done: u64, overlap: u64, gains: (f32, f32)) -> [f32; 2] {
    let at = done as f64 / overlap as f64;
    let fade_in = (at * FRAC_PI_2).sin() as f32;
    let fade_out = ((1.0 - at) * FRAC_PI_2).sin() as f32;
    let new = source_16bit(incoming, RATE);
    let old = source_16bit(outgoing, RATE);
    [0, 1].map(|c| new[c] * gains.0 * fade_in + old[c] * gains.1 * fade_out)
}

fn assert_close(played: &[f32], expected: impl Fn(u64) -> [f32; 2]) {
    for (n, frame) in played.chunks(2).enumerate() {
        let want = expected(n as u64);
        for c in 0..2 {
            assert!((frame[c] - want[c]).abs() <= 1e-6, "frame {n}: {:?} against {want:?}", frame);
        }
    }
}

fn kinds(transitions: &[Transition]) -> Vec<(String, TransitionKind)> {
    transitions.iter().map(|t| (t.key.clone(), t.kind)).collect()
}

/// Loads the fixture as "first", lines up `next` and plays from `lead` frames before the end.
fn playing_near_the_end(path: &Path, next: Next<'_>, crossfade_ms: f64, lead: u64) -> Player {
    let player = Player::new();
    player.set_crossfade(crossfade_ms);
    let track = player.load_entry(path, Some("first".into()), None).unwrap();
    player.preload(Some(next)).unwrap();
    player.seek(track.duration_frames.unwrap() - lead).unwrap();
    player.play().unwrap();
    player
}

/// The golden crossfade: 200 ms between two one-second songs starts 4,410 frames before the end,
/// the next song from its first frame, and the old one goes silent as the overlap ends.
#[test]
fn a_song_ending_on_its_own_fades_into_the_next_over_the_setting() {
    let tone = fixture("tone.wav");
    let player = playing_near_the_end(&tone, Next::new(&tone, "next"), 200.0, 4410 + 100);
    let overlap = 4410;
    let played = play_frames(&player, 100 + overlap as usize + 300);
    let start = RATE as u64 - overlap - 100;
    assert_close(&played, |n| {
        if n < 100 {
            source_16bit(start + n, RATE)
        } else if n < 100 + overlap {
            let done = n - 100;
            mixed(done, start + n, done, overlap, (1.0, 1.0))
        } else {
            source_16bit(n - 100, RATE)
        }
    });
    assert_eq!(
        kinds(&player.take_transitions()),
        [("next".into(), TransitionKind::Crossfade), ("first".into(), TransitionKind::FadeEnded)]
    );
    assert_eq!(player.key().as_deref(), Some("next"));
    assert_eq!(player.progress().position_frames, overlap + 300);
}

#[test]
fn each_song_keeps_its_own_gain_through_the_fade() {
    let tone = fixture("tone.wav");
    let next = Next { gain_db: Some(-6.0), ..Next::new(&tone, "next") };
    let player = Player::new();
    player.set_crossfade(200.0);
    player.load_entry(&tone, Some("first".into()), Some(2.0)).unwrap();
    player.preload(Some(next)).unwrap();
    player.seek(RATE as u64 - 4410).unwrap();
    player.play().unwrap();
    let played = play_frames(&player, 4410);
    let gains = (10f64.powf(-6.0 / 20.0) as f32, 10f64.powf(2.0 / 20.0) as f32);
    let start = RATE as u64 - 4410;
    assert_close(&played, |n| mixed(n, start + n, n, 4410, gains));
}

#[test]
fn the_overlap_is_at_most_half_the_song() {
    let tone = fixture("tone.wav");
    let player = playing_near_the_end(&tone, Next::new(&tone, "next"), 15_000.0, 11_025);
    let played = play_frames(&player, 10);
    assert_close(&played, |n| mixed(n, 11_025 + n, n, 11_025, (1.0, 1.0)));
    assert_eq!(kinds(&player.take_transitions()), [("next".into(), TransitionKind::Crossfade)]);
}

#[test]
fn repeat_one_and_crossfade_off_move_gaplessly() {
    let tone = fixture("tone.wav");
    let repeat = Next { fade: false, ..Next::new(&tone, "again") };
    for (next, crossfade_ms) in [(repeat, 200.0), (Next::new(&tone, "next"), 0.0)] {
        let player = playing_near_the_end(&tone, next, crossfade_ms, 100);
        let played = play_frames(&player, 300);
        assert_close(&played, |n| source_16bit((RATE as u64 - 100 + n) % RATE as u64, RATE));
        let transitions = player.take_transitions();
        assert_eq!(transitions.len(), 1);
        assert_eq!(transitions[0].kind, TransitionKind::Gapless);
    }
}

#[test]
fn a_next_song_at_another_rate_follows_without_a_fade() {
    let tone = fixture("tone.wav");
    let player = playing_near_the_end(&tone, Next::new(&fixture("tone.m4a"), "next"), 200.0, 100);
    let played = play_frames(&player, 100);
    assert_close(&played, |n| source_16bit(RATE as u64 - 100 + n, RATE));
    let mut out = [0.0; 64];
    player.render(&mut out, RATE);
    assert_eq!(kinds(&player.take_transitions()), [("next".into(), TransitionKind::Gapless)]);
}

/// Lined up, or sought, inside the overlap: with a second or more left it fades over what's left
/// (Core's `lateCrossfadeOverlap`), with less it follows gaplessly.
#[test]
fn a_late_next_song_fades_over_what_is_left_or_not_at_all() {
    let song = long_song();
    let left = (1.5 * RATE as f64) as u64;
    let player = playing_near_the_end(song, Next::new(song, "next"), 3000.0, left);
    let played = play_frames(&player, 50);
    let start = 4 * RATE as u64 - left;
    assert_close(&played, |n| mixed(n, start + n, n, left, (1.0, 1.0)));

    let left = (0.8 * RATE as f64) as u64;
    let player = playing_near_the_end(song, Next::new(song, "next"), 3000.0, left);
    let played = play_frames(&player, 50);
    assert_close(&played, |n| source_16bit(4 * RATE as u64 - left + n, RATE));
    assert!(player.take_transitions().is_empty());
}

#[test]
fn pausing_holds_both_songs_and_a_seek_cuts_the_fade() {
    let tone = fixture("tone.wav");
    let player = playing_near_the_end(&tone, Next::new(&tone, "next"), 200.0, 4410);
    play_frames(&player, 1000);
    player.pause().unwrap();
    let mut out = [1.0; 512];
    assert_eq!(player.render(&mut out, RATE), 0);
    assert!(out.iter().all(|&s| s == 0.0));
    player.play().unwrap();
    let played = play_frames(&player, 100);
    let start = RATE as u64 - 4410;
    assert_close(&played, |n| mixed(1000 + n, start + 1000 + n, 1000 + n, 4410, (1.0, 1.0)));

    player.seek(2000).unwrap();
    std::thread::sleep(Duration::from_millis(50));
    let played = play_frames(&player, 100);
    assert_close(&played, |n| source_16bit(2000 + n, RATE));
    assert_eq!(
        kinds(&player.take_transitions()),
        [("next".into(), TransitionKind::Crossfade), ("first".into(), TransitionKind::FadeEnded)]
    );
}

/// The settings are read as each move is decided, so a change applies from the next song, and
/// Normalize Volume's switch at once.
#[test]
fn new_settings_apply_without_a_restart() {
    let tone = fixture("tone.wav");
    let player = playing_near_the_end(&tone, Next::new(&tone, "next"), 0.0, 4410 + 500);
    let before = play_frames(&player, 100);
    player.set_crossfade(200.0);
    let played = play_frames(&player, 500);
    let start = RATE as u64 - 4410 - 500;
    assert_close(&before, |n| source_16bit(start + n, RATE));
    assert_close(&played, |n| {
        if n < 400 {
            source_16bit(start + 100 + n, RATE)
        } else {
            mixed(n - 400, start + 100 + n, n - 400, 4410, (1.0, 1.0))
        }
    });
    assert_eq!(kinds(&player.take_transitions()), [("next".into(), TransitionKind::Crossfade)]);

    let player = Player::new();
    player.load_entry(&tone, Some("first".into()), Some(-6.0)).unwrap();
    player.play().unwrap();
    let quiet = play_frames(&player, 10);
    player.set_normalize(false);
    let plain = play_frames(&player, 10);
    let gain = 10f64.powf(-6.0 / 20.0) as f32;
    assert_close(&quiet, |n| source_16bit(n, RATE).map(|s| s * gain));
    assert_close(&plain, |n| source_16bit(10 + n, RATE));
}
