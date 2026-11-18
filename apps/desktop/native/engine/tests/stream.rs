//! YT Music songs fetched by range: what the decoder reads from a download matches the file, an
//! expired address is resolved again, and the cache keeps under its bound.

mod common;

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use common::fixture;
use wave_audio::cache::AudioCache;
use wave_audio::decode::Decoder;
use wave_audio::engine::Engine;
use wave_audio::player::{Next, PlayState, Player};
use wave_audio::stream::{
    FetchError, Fetched, Fetcher, HttpFetcher, Resolver, StreamAddress, StreamState, Streams,
};

const ID: &str = "abcdefghijk";

fn song() -> Vec<u8> {
    fs::read(fixture("tone.m4a")).unwrap()
}

fn address(url: &str, length: Option<u64>) -> StreamAddress {
    StreamAddress {
        url: url.into(),
        headers: vec![("User-Agent".into(), "test".into())],
        itag: 140,
        mime_type: "audio/mp4".into(),
        content_length: length,
    }
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("wave-stream-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

/// Serves the song from memory. Addresses whose URL is in `expired` answer 403.
#[derive(Default)]
struct Memory {
    songs: HashMap<String, Vec<u8>>,
    expired: Mutex<Vec<String>>,
    failing: bool,
    requests: AtomicUsize,
}

impl Fetcher for Memory {
    fn fetch(&self, address: &StreamAddress, start: u64, end: u64) -> Result<Fetched, FetchError> {
        self.requests.fetch_add(1, Ordering::SeqCst);
        if self.failing {
            return Err(FetchError::Failed("offline".into()));
        }
        if self.expired.lock().unwrap().contains(&address.url) {
            return Err(FetchError::Expired);
        }
        let bytes = &self.songs[&address.url];
        let end = (end as usize).min(bytes.len());
        Ok(Fetched { bytes: bytes[start as usize..end].to_vec(), total: Some(bytes.len() as u64) })
    }
}

/// Hands out `fresh` and counts how often it was asked.
struct Fresh {
    fresh: StreamAddress,
    asked: AtomicUsize,
}

impl Resolver for Fresh {
    fn resolve(&self, _video_id: &str) -> Result<StreamAddress, String> {
        self.asked.fetch_add(1, Ordering::SeqCst);
        Ok(self.fresh.clone())
    }
}

fn never() -> Arc<Fresh> {
    Arc::new(Fresh { fresh: address("never", None), asked: AtomicUsize::new(0) })
}

fn memory(urls: &[&str]) -> Memory {
    let mut fetcher = Memory::default();
    for url in urls {
        fetcher.songs.insert((*url).into(), song());
    }
    fetcher
}

fn decode_all(decoder: &mut Decoder) -> Vec<f32> {
    let mut pcm = Vec::new();
    while let Some(chunk) = decoder.next_chunk().expect("decodes") {
        pcm.extend_from_slice(&chunk);
    }
    pcm
}

fn wait_for(streams: &Streams, id: &str, state: StreamState) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while streams.state(id) != state {
        assert!(Instant::now() < deadline, "{id} never became {state:?}");
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn a_streamed_song_decodes_and_seeks_as_the_file_does() {
    let length = song().len() as u64;
    let streams = Streams::new(
        AudioCache::new(temp_dir("decode"), 1 << 20),
        Arc::new(memory(&["a"])),
        never(),
    )
    .with_chunk(4096);
    assert_eq!(streams.state(ID), StreamState::Missing);
    streams.start(ID, address("a", Some(length)));
    let origin = streams.open(ID).expect("on its way");
    let mut streamed = Decoder::open_origin(&origin).expect("opens the stream");
    let mut file = Decoder::open(&fixture("tone.m4a")).unwrap();
    assert_eq!(streamed.duration_frames(), file.duration_frames(), "the same gapless trim");
    assert_eq!(decode_all(&mut streamed), decode_all(&mut file));

    streamed.seek(9_000).unwrap();
    file.seek(9_000).unwrap();
    assert_eq!(decode_all(&mut streamed), decode_all(&mut file), "after a seek");

    wait_for(&streams, ID, StreamState::Cached);
    let cached = fs::read(streams.cache().dir().join(format!("{ID}.140.m4a"))).unwrap();
    assert_eq!(cached, song(), "the whole song is kept");
}

#[test]
fn a_song_without_a_length_learns_it_from_the_first_chunk() {
    let streams = Streams::new(
        AudioCache::new(temp_dir("length"), 1 << 20),
        Arc::new(memory(&["a"])),
        never(),
    )
    .with_chunk(4096);
    streams.start(ID, address("a", None));
    let origin = streams.open(ID).unwrap();
    let mut streamed = Decoder::open_origin(&origin).unwrap();
    let mut file = Decoder::open(&fixture("tone.m4a")).unwrap();
    assert_eq!(decode_all(&mut streamed), decode_all(&mut file));
}

#[test]
fn an_expired_address_is_resolved_again_without_a_break() {
    let length = song().len() as u64;
    let fetcher = Arc::new(memory(&["old", "new"]));
    let resolver =
        Arc::new(Fresh { fresh: address("new", Some(length)), asked: AtomicUsize::new(0) });
    let streams = Streams::new(
        AudioCache::new(temp_dir("expired"), 1 << 20),
        Arc::clone(&fetcher) as Arc<dyn Fetcher>,
        Arc::clone(&resolver) as Arc<dyn Resolver>,
    )
    .with_chunk(4096);
    fetcher.expired.lock().unwrap().push("old".into());
    streams.start(ID, address("old", Some(length)));
    let origin = streams.open(ID).unwrap();
    let mut streamed = Decoder::open_origin(&origin).expect("plays on the fresh address");
    let mut file = Decoder::open(&fixture("tone.m4a")).unwrap();
    assert_eq!(decode_all(&mut streamed), decode_all(&mut file));
    assert_eq!(resolver.asked.load(Ordering::SeqCst), 1, "one fresh address was enough");
}

#[test]
fn a_song_that_cant_be_fetched_fails_and_leaves_nothing_behind() {
    let fetcher = Memory { failing: true, ..memory(&["a"]) };
    let dir = temp_dir("failed");
    let streams = Streams::new(AudioCache::new(dir.clone(), 1 << 20), Arc::new(fetcher), never());
    streams.start(ID, address("a", Some(song().len() as u64)));
    wait_for(&streams, ID, StreamState::Failed);
    assert!(streams.open(ID).is_none(), "nothing to play");
    assert_eq!(streams.cache().size(), 0);
    // A fresh address starts it again.
    let streams2 = Streams::new(AudioCache::new(dir, 1 << 20), Arc::new(memory(&["a"])), never());
    streams2.start(ID, address("a", Some(song().len() as u64)));
    wait_for(&streams2, ID, StreamState::Cached);
}

#[test]
fn the_cache_stays_under_its_bound_as_songs_stream() {
    let length = song().len() as u64;
    let ids = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"];
    let streams = Streams::new(
        AudioCache::new(temp_dir("bound"), length * 5 / 2),
        Arc::new(memory(&["a"])),
        never(),
    );
    for id in ids {
        streams.start(id, address("a", Some(length)));
        wait_for(&streams, id, StreamState::Cached);
        assert!(streams.cache().size() <= streams.cache().bound(), "over the bound after {id}");
        // A later song counts as newer.
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(streams.state(ids[0]), StreamState::Missing, "the oldest song went");
    assert_eq!(streams.state(ids[3]), StreamState::Cached);
}

#[test]
fn a_playing_song_is_never_evicted() {
    let length = song().len() as u64;
    let streams = Streams::new(
        AudioCache::new(temp_dir("playing"), length * 3 / 2),
        Arc::new(memory(&["a"])),
        never(),
    );
    streams.start("aaaaaaaaaaa", address("a", Some(length)));
    wait_for(&streams, "aaaaaaaaaaa", StreamState::Cached);
    let playing = streams.open("aaaaaaaaaaa").unwrap();
    streams.start("bbbbbbbbbbb", address("a", Some(length)));
    wait_for(&streams, "bbbbbbbbbbb", StreamState::Cached);
    assert!(Decoder::open_origin(&playing).is_ok(), "still there to reopen");
    drop(playing);
    streams.start("ccccccccccc", address("a", Some(length)));
    wait_for(&streams, "ccccccccccc", StreamState::Cached);
    assert_eq!(streams.state("aaaaaaaaaaa"), StreamState::Missing, "evicted once it stopped");
}

/// Serves `bytes` over HTTP with ranges; `/expired` answers 403.
fn serve(bytes: Vec<u8>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
            let mut range = None;
            loop {
                let mut header = String::new();
                if reader.read_line(&mut header).unwrap() == 0 || header == "\r\n" {
                    break;
                }
                let lower = header.to_ascii_lowercase();
                if let Some(value) = lower.strip_prefix("range: bytes=") {
                    let (a, b) = value.trim().split_once('-').unwrap();
                    range = Some((a.parse::<usize>().unwrap(), b.parse::<usize>().unwrap()));
                }
            }
            if path == "/expired" {
                let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
                continue;
            }
            let (a, b) = range.unwrap_or((0, bytes.len() - 1));
            let b = b.min(bytes.len() - 1);
            let body = &bytes[a..=b];
            let head = format!(
                "HTTP/1.1 206 Partial Content\r\ncontent-length: {}\r\ncontent-range: bytes {a}-{b}/{}\r\n\r\n",
                body.len(),
                bytes.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(body);
        }
    });
    format!("http://127.0.0.1:{port}")
}

#[test]
fn the_http_fetcher_asks_for_a_range_and_reads_403_as_expired() {
    let bytes = song();
    let base = serve(bytes.clone());
    let fetcher = HttpFetcher::new();
    let fetched = fetcher.fetch(&address(&format!("{base}/song"), None), 100, 1100).unwrap();
    assert_eq!(fetched.bytes, &bytes[100..1100]);
    assert_eq!(fetched.total, Some(bytes.len() as u64));
    let expired = fetcher.fetch(&address(&format!("{base}/expired"), None), 0, 10);
    assert!(matches!(expired, Err(FetchError::Expired)));
}

#[test]
fn a_failure_never_shows_the_address() {
    // Nothing listens on port 9; the error must not carry the URL or its query.
    let fetcher = HttpFetcher::new();
    let Err(FetchError::Failed(why)) =
        fetcher.fetch(&address("http://127.0.0.1:9/secret?sig=xyz", None), 0, 10)
    else {
        panic!("can't connect")
    };
    assert!(!why.contains("secret") && !why.contains("sig"), "{why}");
}

/// Everything the player hands the output from now until it ends, at `rate`.
fn play_to_end(player: &Player, rate: u32) -> Vec<f32> {
    let mut played = Vec::new();
    let mut block = [0.0f32; 512];
    let deadline = Instant::now() + Duration::from_secs(20);
    player.play().unwrap();
    while player.progress().state == PlayState::Playing {
        assert!(Instant::now() < deadline, "never ended");
        let before = player.progress().position_frames;
        let key = player.key();
        player.render(&mut block, rate);
        let after = player.progress().position_frames;
        // A handover restarts the position; count what the block held.
        let moved = if player.key() == key { after - before } else { block.len() as u64 / 2 };
        played.extend_from_slice(&block[..(moved as usize * 2).min(block.len())]);
        if moved == 0 {
            thread::sleep(Duration::from_millis(1));
        }
    }
    played
}

#[test]
fn one_streamed_song_runs_into_the_next_without_a_gap() {
    let length = song().len() as u64;
    let streams = Streams::new(
        AudioCache::new(temp_dir("gapless"), 1 << 20),
        Arc::new(memory(&["a"])),
        never(),
    )
    .with_chunk(4096);
    streams.start("aaaaaaaaaaa", address("a", Some(length)));
    streams.start("bbbbbbbbbbb", address("a", Some(length)));
    let mut file = Decoder::open(&fixture("tone.m4a")).unwrap();
    let rate = file.sample_rate();
    let one = decode_all(&mut file);

    let player = Player::new();
    player.load_origin(&streams.open("aaaaaaaaaaa").unwrap(), Some("1".into()), None).unwrap();
    let next = Next::new(Path::new("yt:bbbbbbbbbbb"), "2");
    player.preload_origin(Some((streams.open("bbbbbbbbbbb").unwrap(), next))).unwrap();
    let played = play_to_end(&player, rate);
    let mut both = one.clone();
    both.extend_from_slice(&one);
    assert_eq!(played.len(), both.len(), "no frame lost or added at the join");
    assert!(played == both, "the two songs play back to back");
    assert_eq!(player.take_transitions().len(), 1);
}

#[test]
fn the_engine_plays_a_yt_path_from_its_stream() {
    let length = song().len() as u64;
    let streams = Arc::new(Streams::new(
        AudioCache::new(temp_dir("engine"), 1 << 20),
        Arc::new(memory(&["a"])),
        never(),
    ));
    let engine = Engine::with_streams(true, Some(Arc::clone(&streams)));
    let missing = engine.load_entry(Path::new("yt:abcdefghijk"), None, None);
    assert_eq!(missing.unwrap_err().code(), "not-found", "no address yet");
    streams.start(ID, address("a", Some(length)));
    let status = engine.load_entry(Path::new("yt:abcdefghijk"), Some("1".into()), None).unwrap();
    assert_eq!(status.state, PlayState::Paused);
    assert!(status.duration_ms.is_some_and(|ms| ms > 900.0));
}
