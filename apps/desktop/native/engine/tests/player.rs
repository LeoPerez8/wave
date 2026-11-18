//! The player as the output sees it: frames pulled through `render`, with play, pause and seek.

mod common;

use std::time::{Duration, Instant};

use common::{fixture, source_16bit};
use wave_audio::player::{PlayState, Player};
use wave_audio::EngineError;

const RATE: u32 = 22_050;

/// Pulls `frames` frames that actually played, skipping the silence of an empty buffer.
fn play_frames(player: &Player, frames: usize) -> Vec<f32> {
    let mut played = Vec::new();
    let mut block = [0.0f32; 512];
    let deadline = Instant::now() + Duration::from_secs(10);
    while played.len() < frames * 2 {
        let before = player.progress().position_frames;
        player.render(&mut block);
        let moved = (player.progress().position_frames - before) as usize;
        played.extend_from_slice(&block[..moved * 2]);
        if player.progress().state != PlayState::Playing {
            break;
        }
        assert!(Instant::now() < deadline, "the buffer never filled");
        if moved == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    played.truncate(frames * 2);
    played
}

fn assert_signal_from(played: &[f32], first_frame: u64) {
    for (n, frame) in played.chunks(2).enumerate() {
        let at = first_frame + n as u64;
        assert_eq!(frame, source_16bit(at, RATE), "frame {at}");
    }
}

#[test]
fn a_loaded_song_waits_paused_at_its_start() {
    let player = Player::new();
    let track = player.load(&fixture("tone.wav")).expect("loads");
    assert_eq!(track.sample_rate, RATE);
    assert_eq!(track.duration_frames, Some(RATE as u64));
    let progress = player.progress();
    assert_eq!(progress.state, PlayState::Paused);
    assert_eq!(progress.position_frames, 0);

    let mut block = [1.0f32; 64];
    player.render(&mut block);
    assert!(block.iter().all(|&s| s == 0.0), "paused plays silence");
    assert_eq!(player.progress().position_frames, 0);
}

#[test]
fn playing_hands_the_song_to_the_output_and_moves_the_position() {
    let player = Player::new();
    player.load(&fixture("tone.wav")).expect("loads");
    player.play().expect("plays");
    let played = play_frames(&player, 3000);
    assert_signal_from(&played, 0);
    assert!(player.progress().position_frames >= 3000);
}

#[test]
fn pausing_holds_the_position_and_playing_resumes_there() {
    let player = Player::new();
    player.load(&fixture("tone.wav")).expect("loads");
    player.play().expect("plays");
    play_frames(&player, 1000);
    player.pause().expect("pauses");
    let held = player.progress().position_frames;
    let mut block = [1.0f32; 512];
    player.render(&mut block);
    assert!(block.iter().all(|&s| s == 0.0));
    assert_eq!(player.progress().position_frames, held);

    player.play().expect("resumes");
    assert_signal_from(&play_frames(&player, 1000), held);
}

#[test]
fn seeking_plays_from_the_exact_frame() {
    let player = Player::new();
    player.load(&fixture("tone.wav")).expect("loads");
    player.play().expect("plays");
    play_frames(&player, 500);
    player.seek(15_001).expect("seeks");
    assert_eq!(player.progress().position_frames, 15_001);
    assert_signal_from(&play_frames(&player, 2000), 15_001);

    player.pause().expect("pauses");
    player.seek(4_000).expect("seeks while paused");
    assert_eq!(player.progress().state, PlayState::Paused);
    player.play().expect("plays");
    assert_signal_from(&play_frames(&player, 100), 4_000);
}

#[test]
fn a_song_that_plays_to_its_end_stops_and_plays_again_from_the_start() {
    let player = Player::new();
    player.load(&fixture("tone.wav")).expect("loads");
    player.seek(RATE as u64 - 300).expect("seeks");
    player.play().expect("plays");
    let played = play_frames(&player, 1000);
    assert_eq!(played.len(), 600, "only the last 300 frames play");
    let progress = player.progress();
    assert_eq!(progress.state, PlayState::Ended);
    assert_eq!(progress.position_frames, RATE as u64);

    player.play().expect("plays again");
    assert_signal_from(&play_frames(&player, 100), 0);
}

#[test]
fn nothing_plays_before_a_song_is_loaded() {
    let player = Player::new();
    assert_eq!(player.play(), Err(EngineError::NothingLoaded));
    assert_eq!(player.seek(10), Err(EngineError::NothingLoaded));
    assert_eq!(player.progress().state, PlayState::Idle);
}

#[test]
fn a_file_that_fails_to_load_leaves_the_current_song_playing() {
    let player = Player::new();
    player.load(&fixture("tone.wav")).expect("loads");
    player.play().expect("plays");
    let error = player.load(&fixture("missing.flac")).expect_err("refuses");
    assert_eq!(error.code(), "not-found");
    assert_eq!(player.progress().state, PlayState::Playing);
    assert_signal_from(&play_frames(&player, 100), 0);
}
