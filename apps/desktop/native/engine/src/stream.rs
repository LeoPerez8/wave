//! YT Music songs fetched by range into the audio cache while they play
//! (docs/spec-desktop.md, Audio engine). The JVM resolves a song's address; the engine fetches
//! its bytes in chunks, the one playback waits for first, and asks for a fresh address when
//! YouTube says the old one expired. No address or header is ever logged or put in an error.

use std::collections::{HashMap, VecDeque};
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use symphonia::core::io::MediaSource;

use crate::cache::AudioCache;

/// What one request fetches, unless a test asks for less.
pub const CHUNK: u64 = 512 * 1024;
/// How many fresh addresses one download asks for before it gives up.
const RESOLVES: u32 = 3;
/// How many times a chunk is tried again after a network failure.
const RETRIES: u32 = 3;
/// How long playback waits for a chunk before the song breaks there.
const WAIT: Duration = Duration::from_secs(45);
/// Downloads nobody plays that keep going, so a song lined up next is fetched before its turn.
const KEPT: usize = 2;

/// Where a song's bytes are, as the JVM resolved them. It belongs to the session: never logged.
#[derive(Clone)]
pub struct StreamAddress {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub itag: u32,
    pub mime_type: String,
    pub content_length: Option<u64>,
}

impl StreamAddress {
    /// The file extension the cache and the demuxer use for this format.
    pub fn extension(&self) -> &'static str {
        if self.mime_type.contains("webm") { "webm" } else { "m4a" }
    }
}

impl std::fmt::Debug for StreamAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "StreamAddress(itag {})", self.itag)
    }
}

pub struct Fetched {
    pub bytes: Vec<u8>,
    /// The whole file's length, when the server said.
    pub total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    /// 403 or 410: the address is no longer good.
    Expired,
    Failed(String),
}

/// Fetches bytes `start..end` of a song.
pub trait Fetcher: Send + Sync {
    fn fetch(&self, address: &StreamAddress, start: u64, end: u64) -> Result<Fetched, FetchError>;
}

/// Asks the JVM for a fresh address.
pub trait Resolver: Send + Sync {
    fn resolve(&self, video_id: &str) -> Result<StreamAddress, String>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamState {
    /// The whole song is in the cache.
    Cached,
    /// Enough is fetched to start playing.
    Ready,
    Loading,
    Failed,
    /// Nothing is cached or fetching: the song needs an address.
    Missing,
}

impl StreamState {
    pub fn as_str(self) -> &'static str {
        match self {
            StreamState::Cached => "cached",
            StreamState::Ready => "ready",
            StreamState::Loading => "loading",
            StreamState::Failed => "failed",
            StreamState::Missing => "missing",
        }
    }
}

struct Progress {
    address: StreamAddress,
    total: Option<u64>,
    have: Vec<bool>,
    /// The chunk a reader waits for.
    wanted: Option<usize>,
    /// The part file, then the whole one once it's committed.
    path: PathBuf,
    done: bool,
    failed: bool,
    cancelled: bool,
    /// The part file exists, sized to the whole song.
    opened: bool,
}

/// One song being fetched.
pub struct Download {
    video_id: String,
    chunk: u64,
    progress: Mutex<Progress>,
    changed: Condvar,
}

impl Download {
    fn lock(&self) -> MutexGuard<'_, Progress> {
        self.progress.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn video_id(&self) -> &str {
        &self.video_id
    }

    fn state(&self) -> StreamState {
        let progress = self.lock();
        if progress.failed || progress.cancelled {
            StreamState::Failed
        } else if progress.done || progress.have.first() == Some(&true) {
            StreamState::Ready
        } else {
            StreamState::Loading
        }
    }

    /// A reader from the song's first byte; it waits for chunks still on their way.
    pub fn reader(self: &Arc<Download>) -> io::Result<StreamReader> {
        let mut progress = self.lock();
        let deadline = std::time::Instant::now() + WAIT;
        while !progress.opened && !progress.failed && !progress.cancelled {
            progress.wanted = Some(0);
            self.changed.notify_all();
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "the song didn't arrive"));
            }
            progress = self
                .changed
                .wait_timeout(progress, left)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
        let Some(total) = progress.total.filter(|_| !progress.failed && !progress.cancelled) else {
            return Err(io::Error::other("the song couldn't be fetched"));
        };
        let file = File::open(&progress.path)?;
        Ok(StreamReader { download: Arc::clone(self), file, position: 0, total })
    }
}

/// A song's bytes as the demuxer reads them, blocking until the chunk it reaches is fetched.
pub struct StreamReader {
    download: Arc<Download>,
    file: File,
    position: u64,
    total: u64,
}

impl Read for StreamReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.position >= self.total || buf.is_empty() {
            return Ok(0);
        }
        let size = self.download.chunk;
        let chunk = (self.position / size) as usize;
        let mut progress = self.download.lock();
        let deadline = std::time::Instant::now() + WAIT;
        while !progress.have[chunk] {
            if progress.failed || progress.cancelled {
                return Err(io::Error::other("the song couldn't be fetched"));
            }
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "the song didn't arrive"));
            }
            if progress.wanted != Some(chunk) {
                progress.wanted = Some(chunk);
                self.download.changed.notify_all();
            }
            progress = self
                .download
                .changed
                .wait_timeout(progress, left)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
        // Read on through every chunk already here.
        let mut end_chunk = chunk;
        while end_chunk + 1 < progress.have.len() && progress.have[end_chunk + 1] {
            end_chunk += 1;
        }
        drop(progress);
        let available = ((end_chunk as u64 + 1) * size).min(self.total) - self.position;
        let len = (buf.len() as u64).min(available) as usize;
        self.file.seek(SeekFrom::Start(self.position))?;
        let read = self.file.read(&mut buf[..len])?;
        self.position += read as u64;
        Ok(read)
    }
}

impl Seek for StreamReader {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let position = match to {
            SeekFrom::Start(at) => at as i128,
            SeekFrom::End(by) => self.total as i128 + by as i128,
            SeekFrom::Current(by) => self.position as i128 + by as i128,
        };
        if position < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before the start"));
        }
        self.position = position as u64;
        Ok(self.position)
    }
}

impl MediaSource for StreamReader {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.total)
    }
}

impl StreamReader {
    pub fn video_id(&self) -> &str {
        &self.download.video_id
    }
}

#[derive(Default)]
struct Registry {
    downloads: HashMap<String, Arc<Download>>,
    /// Started downloads, newest last.
    order: VecDeque<String>,
    /// How many origins play each song.
    leases: HashMap<String, usize>,
}

impl Registry {
    fn in_use(&self, video_id: &str) -> bool {
        self.downloads.get(video_id).is_some_and(|d| !d.lock().failed)
            || self.leases.get(video_id).is_some_and(|&n| n > 0)
    }
}

/// Keeps a song out of eviction, and its download going, while something plays it.
pub struct Lease {
    video_id: String,
    registry: Arc<Mutex<Registry>>,
}

impl Drop for Lease {
    fn drop(&mut self) {
        let mut registry = lock(&self.registry);
        if let Some(count) = registry.leases.get_mut(&self.video_id) {
            *count -= 1;
            if *count == 0 {
                registry.leases.remove(&self.video_id);
            }
        }
    }
}

fn lock(registry: &Mutex<Registry>) -> MutexGuard<'_, Registry> {
    registry.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Where a decoder reads a song from.
#[derive(Clone)]
pub enum Origin {
    File(PathBuf),
    Cached { path: PathBuf, lease: Arc<Lease> },
    Stream { download: Arc<Download>, lease: Arc<Lease> },
}

impl Origin {
    /// The song's bytes from the start.
    pub fn source(&self) -> io::Result<Box<dyn MediaSource>> {
        match self {
            Origin::File(path) | Origin::Cached { path, .. } => Ok(Box::new(File::open(path)?)),
            Origin::Stream { download, .. } => Ok(Box::new(download.reader()?)),
        }
    }

    /// The format's file extension, as a hint for the demuxer.
    pub fn extension(&self) -> Option<String> {
        match self {
            Origin::File(path) | Origin::Cached { path, .. } => {
                path.extension().and_then(|e| e.to_str()).map(str::to_owned)
            }
            Origin::Stream { download, .. } => Some(download.lock().address.extension().to_owned()),
        }
    }

    pub fn video_id(&self) -> Option<&str> {
        match self {
            Origin::File(_) => None,
            Origin::Cached { lease, .. } | Origin::Stream { lease, .. } => Some(&lease.video_id),
        }
    }
}

/// The songs the engine fetches, and the cache they land in.
pub struct Streams {
    cache: Arc<AudioCache>,
    fetcher: Arc<dyn Fetcher>,
    resolver: Arc<dyn Resolver>,
    registry: Arc<Mutex<Registry>>,
    chunk: u64,
}

impl Streams {
    pub fn new(
        cache: AudioCache,
        fetcher: Arc<dyn Fetcher>,
        resolver: Arc<dyn Resolver>,
    ) -> Streams {
        let _ = fs::create_dir_all(cache.dir());
        Streams {
            cache: Arc::new(cache),
            fetcher,
            resolver,
            registry: Arc::new(Mutex::new(Registry::default())),
            chunk: CHUNK,
        }
    }

    /// Fetches in chunks of `bytes`, so tests cross chunk edges with small songs.
    pub fn with_chunk(mut self, bytes: u64) -> Streams {
        self.chunk = bytes.max(1);
        self
    }

    pub fn cache(&self) -> &AudioCache {
        &self.cache
    }

    pub fn state(&self, video_id: &str) -> StreamState {
        if let Some(download) = lock(&self.registry).downloads.get(video_id) {
            return download.state();
        }
        if self.cache.complete(video_id).is_some() {
            StreamState::Cached
        } else {
            StreamState::Missing
        }
    }

    /// Starts fetching a song from `address`, unless it's cached or already on its way.
    pub fn start(&self, video_id: &str, address: StreamAddress) {
        if self.cache.complete(video_id).is_some() {
            return;
        }
        let mut registry = lock(&self.registry);
        if registry.downloads.get(video_id).is_some_and(|d| d.state() != StreamState::Failed) {
            return;
        }
        let path = self.cache.part(video_id, address.itag, address.extension());
        let have = address.content_length.map_or(Vec::new(), |total| chunks(total, self.chunk));
        let download = Arc::new(Download {
            video_id: video_id.to_owned(),
            chunk: self.chunk,
            progress: Mutex::new(Progress {
                total: address.content_length,
                address,
                have,
                wanted: None,
                path,
                done: false,
                failed: false,
                cancelled: false,
                opened: false,
            }),
            changed: Condvar::new(),
        });
        registry.downloads.insert(video_id.to_owned(), Arc::clone(&download));
        registry.order.retain(|id| id != video_id);
        registry.order.push_back(video_id.to_owned());
        // A download nobody plays and that isn't among the newest stops: the user skipped it.
        let stale: Vec<String> = registry
            .order
            .iter()
            .rev()
            .skip(KEPT)
            .filter(|id| !registry.leases.contains_key(*id))
            .cloned()
            .collect();
        for id in stale {
            if let Some(old) = registry.downloads.get(&id) {
                old.lock().cancelled = true;
                old.changed.notify_all();
            }
        }
        drop(registry);
        let worker = Worker {
            download,
            cache: Arc::clone(&self.cache),
            fetcher: Arc::clone(&self.fetcher),
            resolver: Arc::clone(&self.resolver),
            registry: Arc::clone(&self.registry),
        };
        thread::Builder::new()
            .name("wave-fetch".into())
            .spawn(move || worker.run())
            .expect("starts a fetching thread");
    }

    /// Where to read a song: the cache, or its download. `None` when it needs an address.
    pub fn open(&self, video_id: &str) -> Option<Origin> {
        let mut registry = lock(&self.registry);
        let download = registry.downloads.get(video_id).cloned();
        let origin = match download {
            Some(download) if download.state() != StreamState::Failed => {
                Some(OriginKind::Stream(download))
            }
            _ => self.cache.complete(video_id).map(OriginKind::Cached),
        }?;
        *registry.leases.entry(video_id.to_owned()).or_default() += 1;
        drop(registry);
        let lease =
            Arc::new(Lease { video_id: video_id.to_owned(), registry: Arc::clone(&self.registry) });
        Some(match origin {
            OriginKind::Stream(download) => Origin::Stream { download, lease },
            OriginKind::Cached(path) => Origin::Cached { path, lease },
        })
    }
}

enum OriginKind {
    Stream(Arc<Download>),
    Cached(PathBuf),
}

fn chunks(total: u64, size: u64) -> Vec<bool> {
    vec![false; total.div_ceil(size).max(1) as usize]
}

struct Worker {
    download: Arc<Download>,
    cache: Arc<AudioCache>,
    fetcher: Arc<dyn Fetcher>,
    resolver: Arc<dyn Resolver>,
    registry: Arc<Mutex<Registry>>,
}

enum Step {
    Fetch(usize),
    Done,
    Stop,
}

impl Worker {
    fn run(self) {
        let ok = self.fetch_all().is_ok();
        let id = self.download.video_id.clone();
        let mut progress = self.download.lock();
        let cancelled = progress.cancelled;
        if ok {
            progress.done = true;
        } else {
            progress.failed = !cancelled;
        }
        let path = progress.path.clone();
        self.download.changed.notify_all();
        drop(progress);
        let mut registry = lock(&self.registry);
        let replaced = !self.current(&registry) && registry.downloads.contains_key(&id);
        let ours = self.current(&registry);
        // A download of the song started since writes the same part file, so it stays.
        if !ok && !replaced {
            let _ = fs::remove_file(&path);
        }
        // A failed download stays, so its state says so until the song is resolved again.
        if ours && (ok || cancelled) {
            registry.downloads.remove(&id);
            registry.order.retain(|other| *other != id);
        }
        drop(registry);
        let registry = Arc::clone(&self.registry);
        // The song just fetched likely plays next, so it stays.
        self.cache.make_room(0, &|video_id| video_id == id || lock(&registry).in_use(video_id));
    }

    fn fetch_all(&self) -> Result<(), ()> {
        let mut address = self.download.lock().address.clone();
        let mut resolves = 0;
        let mut file: Option<File> = None;
        let mut cursor = 0usize;
        loop {
            let (step, total) = self.next(cursor);
            let index = match step {
                Step::Stop => return Err(()),
                Step::Done => break,
                Step::Fetch(index) => index,
            };
            let size = self.download.chunk;
            let start = index as u64 * size;
            let end = total.map_or(start + size, |total| (start + size).min(total));
            let mut retries = 0;
            let fetched = loop {
                match self.fetcher.fetch(&address, start, end) {
                    Ok(fetched) => break fetched,
                    Err(FetchError::Expired) if resolves < RESOLVES => {
                        resolves += 1;
                        let fresh =
                            self.resolver.resolve(&self.download.video_id).map_err(|_| ())?;
                        // Another format or length would put bytes in the wrong places.
                        if fresh.itag != address.itag
                            || (fresh.content_length.is_some()
                                && total.is_some()
                                && fresh.content_length != total)
                        {
                            return Err(());
                        }
                        address = fresh;
                        self.download.lock().address = address.clone();
                    }
                    Err(FetchError::Failed(_)) if retries < RETRIES => {
                        retries += 1;
                        thread::sleep(Duration::from_millis(200 << retries));
                    }
                    Err(_) => return Err(()),
                }
                if self.download.lock().cancelled {
                    return Err(());
                }
            };
            let total = match total.or(fetched.total) {
                Some(total) => total,
                None => return Err(()),
            };
            if fetched.bytes.len() as u64 != end.min(total) - start {
                return Err(());
            }
            if file.is_none() {
                let path = self.download.lock().path.clone();
                let reserve = total;
                let registry = Arc::clone(&self.registry);
                self.cache.make_room(reserve, &|video_id| lock(&registry).in_use(video_id));
                // Under the registry's lock, so a download that was stopped and started again
                // meanwhile doesn't empty the file its successor writes.
                let created = {
                    let registry = lock(&self.registry);
                    if !self.current(&registry) || self.download.lock().cancelled {
                        return Err(());
                    }
                    File::options()
                        .read(true)
                        .write(true)
                        .create(true)
                        .truncate(true)
                        .open(&path)
                        .and_then(|f| f.set_len(total).map(|_| f))
                };
                file = Some(created.map_err(|_| ())?);
                let mut progress = self.download.lock();
                if progress.total.is_none() {
                    progress.total = Some(total);
                    progress.have = chunks(total, size);
                }
                progress.opened = true;
            }
            let out = file.as_mut().expect("opened above");
            out.seek(SeekFrom::Start(start))
                .and_then(|_| out.write_all(&fetched.bytes))
                .map_err(|_| ())?;
            let mut progress = self.download.lock();
            progress.have[index] = true;
            if progress.wanted == Some(index) {
                progress.wanted = None;
            }
            cursor = index + 1;
            self.download.changed.notify_all();
        }
        let Some(file) = file else { return Err(()) };
        file.sync_all().map_err(|_| ())?;
        drop(file);
        let mut progress = self.download.lock();
        let whole = self.cache.commit(&progress.path).map_err(|_| ())?;
        progress.path = whole;
        Ok(())
    }

    /// Whether this is still the song's download, and not one started after it was stopped.
    fn current(&self, registry: &Registry) -> bool {
        registry
            .downloads
            .get(&self.download.video_id)
            .is_some_and(|d| Arc::ptr_eq(d, &self.download))
    }

    /// The chunk to fetch next: the one a reader waits for, else the next one in order.
    fn next(&self, cursor: usize) -> (Step, Option<u64>) {
        let progress = self.download.lock();
        if progress.cancelled {
            return (Step::Stop, progress.total);
        }
        if progress.total.is_none() {
            return (Step::Fetch(0), None);
        }
        let missing = |i: &usize| !progress.have[*i];
        let step = progress
            .wanted
            .filter(|i| *i < progress.have.len() && missing(i))
            .or_else(|| (cursor..progress.have.len()).find(missing))
            .or_else(|| (0..progress.have.len()).find(missing))
            .map_or(Step::Done, Step::Fetch);
        (step, progress.total)
    }
}

/// Fetches over HTTPS with the address's own headers.
pub struct HttpFetcher {
    agent: ureq::Agent,
}

impl HttpFetcher {
    pub fn new() -> HttpFetcher {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .http_status_as_error(false)
            .build();
        HttpFetcher { agent: ureq::Agent::new_with_config(config) }
    }
}

impl Default for HttpFetcher {
    fn default() -> HttpFetcher {
        HttpFetcher::new()
    }
}

impl Fetcher for HttpFetcher {
    fn fetch(&self, address: &StreamAddress, start: u64, end: u64) -> Result<Fetched, FetchError> {
        let mut request =
            self.agent.get(&address.url).header("Range", format!("bytes={start}-{}", end - 1));
        for (name, value) in &address.headers {
            if !name.eq_ignore_ascii_case("range") {
                request = request.header(name, value);
            }
        }
        // ureq's errors can carry the address, so only their kind goes on.
        let mut response =
            request.call().map_err(|_| FetchError::Failed("the request failed".into()))?;
        match response.status().as_u16() {
            403 | 410 => return Err(FetchError::Expired),
            200 | 206 => {}
            status => return Err(FetchError::Failed(format!("HTTP {status}"))),
        }
        let partial = response.status().as_u16() == 206;
        let total = response
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit('/').next())
            .and_then(|v| v.parse::<u64>().ok());
        let bytes = response
            .body_mut()
            .with_config()
            .limit(if partial { end - start } else { u64::MAX })
            .read_to_vec()
            .map_err(|_| FetchError::Failed("the download broke".into()))?;
        if partial {
            Ok(Fetched { bytes, total })
        } else {
            // A server that ignores ranges sends the whole file.
            let total = bytes.len() as u64;
            let slice = bytes.get(start as usize..end.min(total) as usize).unwrap_or_default();
            Ok(Fetched { bytes: slice.to_vec(), total: Some(total) })
        }
    }
}
