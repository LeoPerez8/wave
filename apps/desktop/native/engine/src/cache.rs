//! The audio cache: YT Music songs as the engine fetched them, kept whole so a song played
//! again starts without asking YouTube (docs/spec-desktop.md, Local data). It stays under its
//! bound by dropping the songs used longest ago, never one that is playing or downloading.
//!
//! A song is the file `<videoId>.<itag>.<extension>`; while it downloads it carries `.part`
//! after that. Its last use is its modified time.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// 1 GB, as the phone's cache.
pub const DEFAULT_BOUND: u64 = 1 << 30;

const PART: &str = "part";

pub struct AudioCache {
    dir: PathBuf,
    bound: u64,
    /// One eviction at a time.
    evicting: Mutex<()>,
}

struct Entry {
    path: PathBuf,
    video_id: String,
    size: u64,
    used: SystemTime,
    part: bool,
}

/// The video id a cache file holds, from its name.
fn video_id(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let id = name.split('.').next()?;
    (!id.is_empty()).then(|| id.to_string())
}

impl AudioCache {
    pub fn new(dir: PathBuf, bound: u64) -> AudioCache {
        AudioCache { dir, bound, evicting: Mutex::new(()) }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn bound(&self) -> u64 {
        self.bound
    }

    /// The song's whole file, marked as used now, when an earlier play kept it.
    pub fn complete(&self, video_id: &str) -> Option<PathBuf> {
        let found = self.entries().into_iter().find(|e| !e.part && e.video_id == video_id)?;
        touch(&found.path);
        Some(found.path)
    }

    /// Where a song downloads to before it's whole.
    pub fn part(&self, video_id: &str, itag: u32, extension: &str) -> PathBuf {
        self.dir.join(format!("{video_id}.{itag}.{extension}.{PART}"))
    }

    /// Keeps the whole song `part` downloaded, under its own name.
    pub fn commit(&self, part: &Path) -> io::Result<PathBuf> {
        let whole = part.with_extension("");
        fs::rename(part, &whole)?;
        touch(&whole);
        Ok(whole)
    }

    /// Every byte the cache holds, downloads included.
    pub fn size(&self) -> u64 {
        self.entries().iter().map(|e| e.size).sum()
    }

    /// Drops the songs used longest ago until `reserve` more bytes fit under the bound, keeping
    /// those `in_use` says are playing or downloading. A download nobody holds is dropped first.
    pub fn make_room(&self, reserve: u64, in_use: &dyn Fn(&str) -> bool) {
        let _one = self.evicting.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut entries = self.entries();
        let mut total: u64 = entries.iter().map(|e| e.size).sum();
        // Abandoned downloads first, then whole songs by last use.
        entries.sort_by_key(|e| (!e.part, e.used));
        for entry in entries {
            if total.saturating_add(reserve) <= self.bound && !entry.part {
                break;
            }
            if in_use(&entry.video_id) {
                continue;
            }
            if fs::remove_file(&entry.path).is_ok() {
                total = total.saturating_sub(entry.size);
            }
        }
    }

    fn entries(&self) -> Vec<Entry> {
        let Ok(read) = fs::read_dir(&self.dir) else { return Vec::new() };
        read.filter_map(|item| {
            let item = item.ok()?;
            let meta = item.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let path = item.path();
            Some(Entry {
                video_id: video_id(&path)?,
                part: path.extension().is_some_and(|e| e == PART),
                size: meta.len(),
                used: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                path,
            })
        })
        .collect()
    }
}

fn touch(path: &Path) {
    if let Ok(file) = fs::File::options().append(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wave-cache-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A whole song of `size` bytes, last used `age` seconds ago.
    fn song(cache: &AudioCache, id: &str, size: usize, age: u64) -> PathBuf {
        let path = cache.dir().join(format!("{id}.140.m4a"));
        fs::write(&path, vec![0u8; size]).unwrap();
        let file = fs::File::options().append(true).open(&path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(age)).unwrap();
        path
    }

    #[test]
    fn evicts_the_songs_used_longest_ago_until_the_new_one_fits() {
        let cache = AudioCache::new(temp_dir("lru"), 1000);
        let oldest = song(&cache, "aaaaaaaaaaa", 400, 300);
        let older = song(&cache, "bbbbbbbbbbb", 400, 200);
        let recent = song(&cache, "ccccccccccc", 100, 100);
        cache.make_room(300, &|_| false);
        assert!(!oldest.exists(), "the song used longest ago goes");
        assert!(older.exists() && recent.exists(), "the rest fit with the new song");
        assert!(cache.size() + 300 <= cache.bound());
    }

    #[test]
    fn a_song_played_again_counts_as_used_now() {
        let cache = AudioCache::new(temp_dir("touch"), 1000);
        let first = song(&cache, "aaaaaaaaaaa", 400, 300);
        let second = song(&cache, "bbbbbbbbbbb", 400, 200);
        assert_eq!(cache.complete("aaaaaaaaaaa"), Some(first.clone()));
        cache.make_room(300, &|_| false);
        assert!(first.exists(), "just played");
        assert!(!second.exists());
    }

    #[test]
    fn never_evicts_a_song_in_use() {
        let cache = AudioCache::new(temp_dir("in-use"), 500);
        let playing = song(&cache, "aaaaaaaaaaa", 400, 300);
        let idle = song(&cache, "bbbbbbbbbbb", 400, 100);
        cache.make_room(100, &|id| id == "aaaaaaaaaaa");
        assert!(playing.exists());
        assert!(!idle.exists());
    }

    #[test]
    fn drops_abandoned_downloads_first_and_keeps_live_ones() {
        let cache = AudioCache::new(temp_dir("parts"), 10_000);
        let abandoned = cache.part("aaaaaaaaaaa", 140, "m4a");
        fs::write(&abandoned, vec![0u8; 10]).unwrap();
        let live = cache.part("bbbbbbbbbbb", 140, "m4a");
        fs::write(&live, vec![0u8; 10]).unwrap();
        let kept = song(&cache, "ccccccccccc", 10, 10);
        cache.make_room(0, &|id| id == "bbbbbbbbbbb");
        assert!(!abandoned.exists());
        assert!(live.exists() && kept.exists());
    }

    #[test]
    fn a_finished_download_is_found_whole() {
        let cache = AudioCache::new(temp_dir("commit"), 1000);
        let part = cache.part("aaaaaaaaaaa", 140, "m4a");
        fs::write(&part, b"song").unwrap();
        assert_eq!(cache.complete("aaaaaaaaaaa"), None, "not while it downloads");
        let whole = cache.commit(&part).unwrap();
        assert_eq!(whole.file_name().unwrap(), "aaaaaaaaaaa.140.m4a");
        assert_eq!(cache.complete("aaaaaaaaaaa"), Some(whole));
    }
}
