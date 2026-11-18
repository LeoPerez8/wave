//! Sends the player's frames to the system's default output device, and follows it when it
//! changes. Without a device the song keeps time on a silent clock, so position still moves.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, ErrorKind, StreamConfig, SupportedBufferSize};

use crate::player::Player;

/// How often the output thread looks at the device and the song's rate.
const TICK: Duration = Duration::from_millis(50);
/// How often it asks the system which device is the default.
const DEVICE_CHECK: Duration = Duration::from_secs(1);

/// The callback period asked of devices that buffer deeply by default, in seconds. PulseAudio
/// otherwise takes up to two seconds ahead, so a pause would be heard late and the position
/// would run ahead of the sound.
const PERIOD_SECONDS: f64 = 0.05;

/// A period of [`PERIOD_SECONDS`] at `rate`, if the device takes one that size.
pub fn buffer_for(supported: &SupportedBufferSize, rate: u32) -> BufferSize {
    let period = (rate as f64 * PERIOD_SECONDS) as u32;
    match supported {
        SupportedBufferSize::Range { min, max } if (*min..=*max).contains(&period) => {
            BufferSize::Fixed(period)
        }
        _ => BufferSize::Default,
    }
}

/// The buffer to ask `device` for. Linux's sound servers buffer deeply unless asked not to;
/// WASAPI's shared-mode default is already short.
fn buffer_on(device: &cpal::Device, rate: u32) -> BufferSize {
    if !cfg!(target_os = "linux") {
        return BufferSize::Default;
    }
    device
        .default_output_config()
        .map(|config| buffer_for(config.buffer_size(), rate))
        .unwrap_or(BufferSize::Default)
}

/// The stream that is playing, as far as deciding whether to rebuild it goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opened {
    pub device_id: String,
    pub rate: u32,
}

/// Whether the stream must be built again: none is open, it broke, the song's rate changed, or
/// the system moved its default output to another device.
pub fn needs_rebuild(
    opened: Option<&Opened>,
    broken: bool,
    rate: u32,
    default_id: Option<&str>,
) -> bool {
    match opened {
        None => true,
        Some(opened) => {
            broken || opened.rate != rate || default_id.is_some_and(|id| id != opened.device_id)
        }
    }
}

/// Whether a stream error means the stream no longer plays. WASAPI reports a change of default
/// device this way; PulseAudio and PipeWire move the stream themselves.
pub fn breaks_stream(kind: ErrorKind) -> bool {
    !matches!(kind, ErrorKind::Xrun | ErrorKind::DeviceChanged | ErrorKind::RealtimeDenied)
}

/// Turns the player's stereo at the song's rate into what the device takes, when the device
/// refuses the song's own rate or two channels.
pub struct Adapter {
    step: f64,
    channels: usize,
    /// How far past `from` the next output frame sits, from 0 to 1.
    phase: f64,
    from: [f32; 2],
    to: [f32; 2],
    input: Vec<f32>,
    used: usize,
}

impl Adapter {
    pub fn new(song_rate: u32, device_rate: u32, device_channels: usize) -> Adapter {
        Adapter {
            step: song_rate as f64 / device_rate as f64,
            channels: device_channels.max(1),
            phase: 1.0,
            from: [0.0; 2],
            to: [0.0; 2],
            input: Vec::new(),
            used: 0,
        }
    }

    /// Fills `out` (interleaved, the device's channels) pulling song frames from `pull`.
    pub fn fill(&mut self, out: &mut [f32], mut pull: impl FnMut(&mut [f32])) {
        for frame in out.chunks_mut(self.channels) {
            while self.phase >= 1.0 {
                if self.used == self.input.len() {
                    self.input.resize(512, 0.0);
                    pull(&mut self.input);
                    self.used = 0;
                }
                self.from = self.to;
                self.to = [self.input[self.used], self.input[self.used + 1]];
                self.used += 2;
                self.phase -= 1.0;
            }
            let t = self.phase as f32;
            let left = self.from[0] + (self.to[0] - self.from[0]) * t;
            let right = self.from[1] + (self.to[1] - self.from[1]) * t;
            match frame.len() {
                1 => frame[0] = (left + right) / 2.0,
                _ => {
                    frame.fill(0.0);
                    frame[0] = left;
                    frame[1] = right;
                }
            }
            self.phase += self.step;
        }
    }
}

/// The output thread and what the engine reads from it.
pub struct Output {
    stop: mpsc::Sender<()>,
    device: Arc<Mutex<Option<String>>>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Output {
    /// Starts playing `player` on the default device; `silent` keeps time without a device.
    pub fn start(player: Arc<Player>, silent: bool) -> Output {
        let (stop, stopped) = mpsc::channel();
        let device = Arc::new(Mutex::new(None));
        let shown = Arc::clone(&device);
        let worker = thread::Builder::new()
            .name("wave-output".into())
            .spawn(move || run(&player, silent, &stopped, &shown))
            .expect("starts the output thread");
        Output { stop, device, worker: Some(worker) }
    }

    /// The device playing, by the name the system gives it.
    pub fn device(&self) -> Option<String> {
        self.device.lock().ok().and_then(|name| name.clone())
    }
}

impl Drop for Output {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

struct Playing {
    _stream: cpal::Stream,
    opened: Opened,
    broken: Arc<AtomicBool>,
}

fn run(
    player: &Arc<Player>,
    silent: bool,
    stopped: &mpsc::Receiver<()>,
    shown: &Mutex<Option<String>>,
) {
    let host = cpal::default_host();
    let mut playing: Option<Playing> = None;
    let mut last_check: Option<Instant> = None;
    let mut clock = Instant::now();
    let mut silence = Vec::new();
    loop {
        match stopped.recv_timeout(TICK) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        let rate = player.progress().track.map_or(44_100, |track| track.sample_rate);
        if !silent && last_check.is_none_or(|at| at.elapsed() >= DEVICE_CHECK) {
            last_check = Some(Instant::now());
            let default_id =
                host.default_output_device().and_then(|d| d.id().ok()).map(|id| id.to_string());
            let opened = playing.as_ref().map(|p| &p.opened);
            let broken = playing.as_ref().is_some_and(|p| p.broken.load(Ordering::Relaxed));
            if needs_rebuild(opened, broken, rate, default_id.as_deref()) {
                drop(playing.take());
                playing = open(&host, player, rate);
                *shown.lock().unwrap_or_else(|p| p.into_inner()) = playing
                    .as_ref()
                    .and_then(|_| host.default_output_device())
                    .and_then(|d| d.description().ok())
                    .map(|d| d.name().to_string());
                clock = Instant::now();
            }
        } else if let Some(current) = playing.as_ref() {
            // A broken stream or a new rate shouldn't wait for the next device check.
            if current.broken.load(Ordering::Relaxed) || current.opened.rate != rate {
                last_check = None;
            }
        }
        if playing.is_none() {
            // No device: the song keeps time in silence. A stalled thread doesn't race to catch up.
            if clock.elapsed() > DEVICE_CHECK {
                clock = Instant::now() - TICK;
            }
            let due = (clock.elapsed().as_secs_f64() * rate as f64) as usize;
            if due > 0 {
                silence.resize(due * 2, 0.0);
                player.render(&mut silence, rate);
                clock += Duration::from_secs_f64(due as f64 / rate as f64);
            }
        }
    }
}

fn open(host: &cpal::Host, player: &Arc<Player>, rate: u32) -> Option<Playing> {
    let device = host.default_output_device()?;
    let device_id = device.id().ok()?.to_string();
    let broken = Arc::new(AtomicBool::new(false));
    let wanted =
        StreamConfig { channels: 2, sample_rate: rate, buffer_size: buffer_on(&device, rate) };
    let stream = build(&device, wanted, rate, player, &broken).or_else(|| {
        // The device won't take the song as it is: play at its own rate and channels.
        let mut own = device.default_output_config().ok()?.config();
        own.buffer_size = buffer_on(&device, own.sample_rate);
        build(&device, own, rate, player, &broken)
    })?;
    stream.play().ok()?;
    Some(Playing { _stream: stream, opened: Opened { device_id, rate }, broken })
}

fn build(
    device: &cpal::Device,
    config: StreamConfig,
    song_rate: u32,
    player: &Arc<Player>,
    broken: &Arc<AtomicBool>,
) -> Option<cpal::Stream> {
    let player = Arc::clone(player);
    let broken = Arc::clone(broken);
    let direct = config.channels == 2 && config.sample_rate == song_rate;
    let mut adapter = Adapter::new(song_rate, config.sample_rate, config.channels as usize);
    device
        .build_output_stream::<f32, _, _>(
            config,
            move |out: &mut [f32], _| {
                if direct {
                    player.render(out, song_rate);
                } else {
                    adapter.fill(out, |input| player.render(input, song_rate));
                }
            },
            move |error| {
                if breaks_stream(error.kind()) {
                    broken.store(true, Ordering::Relaxed);
                }
            },
            None,
        )
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opened() -> Opened {
        Opened { device_id: "wasapi:speakers".into(), rate: 44_100 }
    }

    #[test]
    fn a_stream_is_built_when_none_is_open() {
        assert!(needs_rebuild(None, false, 44_100, Some("wasapi:speakers")));
    }

    #[test]
    fn a_healthy_stream_on_the_default_device_is_kept() {
        assert!(!needs_rebuild(Some(&opened()), false, 44_100, Some("wasapi:speakers")));
        assert!(!needs_rebuild(Some(&opened()), false, 44_100, None), "no default: keep trying it");
    }

    #[test]
    fn the_stream_follows_a_new_default_device() {
        assert!(needs_rebuild(Some(&opened()), false, 44_100, Some("wasapi:headphones")));
    }

    #[test]
    fn a_broken_stream_or_a_new_rate_is_rebuilt() {
        assert!(needs_rebuild(Some(&opened()), true, 44_100, Some("wasapi:speakers")));
        assert!(needs_rebuild(Some(&opened()), false, 48_000, Some("wasapi:speakers")));
    }

    #[test]
    fn only_errors_that_stop_the_stream_rebuild_it() {
        assert!(breaks_stream(ErrorKind::StreamInvalidated));
        assert!(breaks_stream(ErrorKind::DeviceNotAvailable));
        assert!(!breaks_stream(ErrorKind::Xrun));
        assert!(!breaks_stream(ErrorKind::DeviceChanged));
    }

    fn ramp(start: f32) -> impl FnMut(&mut [f32]) {
        let mut next = start;
        move |input: &mut [f32]| {
            for frame in input.chunks_mut(2) {
                frame[0] = next;
                frame[1] = -next;
                next += 1.0;
            }
        }
    }

    #[test]
    fn a_short_period_is_asked_for_when_the_device_allows_it() {
        let range = SupportedBufferSize::Range { min: 1, max: 100_000 };
        assert_eq!(buffer_for(&range, 48_000), BufferSize::Fixed(2_400));
        let narrow = SupportedBufferSize::Range { min: 4_096, max: 8_192 };
        assert_eq!(buffer_for(&narrow, 48_000), BufferSize::Default);
        assert_eq!(buffer_for(&SupportedBufferSize::Unknown, 44_100), BufferSize::Default);
    }

    #[test]
    fn the_adapter_passes_the_song_through_at_its_own_rate() {
        let mut adapter = Adapter::new(44_100, 44_100, 2);
        let mut out = [0.0; 8];
        adapter.fill(&mut out, ramp(1.0));
        // One frame of latency: the first output frame is the silence before the song.
        assert_eq!(out, [0.0, 0.0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0]);
    }

    #[test]
    fn the_adapter_fills_in_frames_for_a_faster_device() {
        let mut adapter = Adapter::new(24_000, 48_000, 2);
        let mut out = [0.0; 12];
        adapter.fill(&mut out, ramp(1.0));
        assert_eq!(out, [0.0, 0.0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0, 2.5, -2.5]);
    }

    #[test]
    fn the_adapter_mixes_down_to_mono_and_leaves_extra_channels_silent() {
        let mut mono = Adapter::new(44_100, 44_100, 1);
        let mut out = [9.0; 2];
        mono.fill(&mut out, |input: &mut [f32]| {
            for frame in input.chunks_mut(2) {
                frame.copy_from_slice(&[0.2, 0.4]);
            }
        });
        assert!((out[1] - 0.3).abs() < 1e-6);

        let mut surround = Adapter::new(44_100, 44_100, 4);
        let mut out = [9.0; 8];
        surround.fill(&mut out, ramp(1.0));
        assert_eq!(&out[4..], &[1.0, -1.0, 0.0, 0.0]);
    }
}
