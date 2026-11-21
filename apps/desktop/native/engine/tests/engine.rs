//! The engine as the app drives it: milliseconds in, status out, time kept by the output.

mod common;

use std::thread::sleep;
use std::time::{Duration, Instant};

use common::fixture;
use wave_audio::engine::Engine;
use wave_audio::player::PlayState;

fn wait_for(engine: &Engine, what: impl Fn(f64) -> bool) -> f64 {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let position = engine.status().position_ms;
        if what(position) {
            return position;
        }
        assert!(Instant::now() < deadline, "position stuck at {position} ms");
        sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_song_plays_in_real_time_pauses_and_seeks() {
    let engine = Engine::silent();
    let status = engine.load(&fixture("tone.flac")).expect("loads");
    assert_eq!(status.state, PlayState::Paused);
    assert_eq!(status.duration_ms, Some(1000.0));
    assert_eq!(status.position_ms, 0.0);

    let started = Instant::now();
    engine.play().expect("plays");
    let position = wait_for(&engine, |ms| ms >= 200.0);
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    assert!(position <= elapsed + 60.0, "{position} ms played in {elapsed} ms");

    engine.pause().expect("pauses");
    let held = engine.status().position_ms;
    sleep(Duration::from_millis(150));
    assert_eq!(engine.status().position_ms, held);
    assert_eq!(engine.status().state, PlayState::Paused);

    engine.seek(700.0).expect("seeks");
    assert_eq!(engine.status().position_ms, 700.0);
    engine.play().expect("plays");
    wait_for(&engine, |ms| ms > 750.0);
    let deadline = Instant::now() + Duration::from_secs(5);
    while engine.status().state != PlayState::Ended {
        assert!(Instant::now() < deadline, "never reached the end");
        sleep(Duration::from_millis(10));
    }
    assert_eq!(engine.status().position_ms, 1000.0);
}

#[test]
fn every_format_plays_on_the_default_device_or_keeps_time_without_one() {
    let engine = Engine::new();
    for name in ["tone.mp3", "tone.m4a", "tone.flac", "tone.ogg", "tone.wav", "tone.opus"] {
        engine.load(&fixture(name)).expect("loads");
        engine.seek(300.0).expect("seeks");
        engine.play().expect("plays");
        wait_for(&engine, |ms| ms >= 400.0);
        engine.pause().expect("pauses");
    }
}

#[test]
fn a_seek_before_any_song_is_refused() {
    let engine = Engine::silent();
    assert_eq!(engine.seek(10.0).map_err(|e| e.code()), Err("nothing-loaded"));
}

fn measurements(engine: &Engine, count: usize) -> Vec<(String, &'static str)> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut done = Vec::new();
    while done.len() < count {
        done.extend(engine.take_measurements().into_iter().map(|(id, m)| (id, m.kind())));
        assert!(Instant::now() < deadline, "measured only {done:?}");
        sleep(Duration::from_millis(5));
    }
    done
}

#[test]
fn songs_are_measured_in_turn_while_one_plays_and_a_cancel_drops_the_rest() {
    let engine = Engine::silent();
    engine.load(&fixture("tone.flac")).expect("loads");
    engine.play().expect("plays");
    engine.measure(&fixture("tone.ogg"), "1".into());
    engine.measure(&fixture("missing.ogg"), "2".into());
    assert_eq!(
        measurements(&engine, 2),
        [("1".to_string(), "measured"), ("2".to_string(), "unreadable")]
    );

    engine.cancel_measurements();
    for id in ["3", "4", "5"] {
        engine.measure(&fixture("tone.wav"), id.into());
    }
    engine.cancel_measurements();
    let done = measurements(&engine, 3);
    assert!(done.iter().any(|(_, kind)| *kind == "cancelled"), "{done:?}");
    assert_eq!(done.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>().len(), 3);
}

#[test]
fn choosing_an_output_keeps_the_song_where_it_is() {
    let engine = Engine::silent();
    assert!(engine.outputs().is_empty(), "a silent engine opens no device");
    engine.load(&fixture("tone.flac")).expect("loads");
    engine.play().expect("plays");
    let before = wait_for(&engine, |ms| ms >= 200.0);

    // A device the system doesn't have: the song goes on, on the default.
    engine.set_output(Some("wasapi:unplugged".into()));
    let after = wait_for(&engine, |ms| ms >= before + 100.0);
    assert!(after < 1000.0, "the song didn't start again or run to its end: {after} ms");
    assert_eq!(engine.status().state, PlayState::Playing);
    engine.set_output(None);
    wait_for(&engine, |ms| ms > after);
}

#[test]
fn the_system_outputs_are_listed_and_one_can_be_chosen_mid_song() {
    let engine = Engine::new();
    engine.load(&fixture("tone.flac")).expect("loads");
    engine.play().expect("plays");
    wait_for(&engine, |ms| ms >= 100.0);
    let outputs = engine.outputs();
    // Without a device (CI) there is nothing to choose; the song still keeps time.
    let Some(last) = outputs.last() else {
        assert_eq!(engine.status().device, None);
        return;
    };
    engine.pause().expect("pauses");
    let held = engine.status().position_ms;
    engine.set_output(Some(last.id.clone()));
    let deadline = Instant::now() + Duration::from_secs(1);
    while engine.status().device.as_deref() != Some(last.name.as_str()) {
        assert!(Instant::now() < deadline, "playback didn't move to {} in a second", last.name);
        sleep(Duration::from_millis(10));
    }
    assert_eq!(engine.status().position_ms, held, "the move keeps the position");
}
