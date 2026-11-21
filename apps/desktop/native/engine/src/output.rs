//! Sends the player's frames to an output device: the one chosen while the system has it, else
//! the system's default, followed when it changes. Without a device the song keeps time on a
//! silent clock, so position still moves.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, ErrorKind, StreamConfig, SupportedBufferSize};

use crate::player::Player;

/// How often the output thread looks at the device and the song's rate.
const TICK: Duration = Duration::from_millis(50);
/// How often it asks the system which devices it has and which is the default.
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

/// An output the system has: `id` stays the same across restarts, `name` is what the system
/// calls it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
}

/// The device to play on: the chosen one while it is among `present`, else the system's default.
pub fn target_device<'a>(
    chosen: Option<&'a str>,
    present: &[OutputDevice],
    default_id: Option<&'a str>,
) -> Option<&'a str> {
    chosen.filter(|id| present.iter().any(|device| device.id == *id)).or(default_id)
}

/// Whether the stream must be built again: none is open, it broke, the song's rate changed, or
/// the device to play on (`target_id`) is another one.
pub fn needs_rebuild(
    opened: Option<&Opened>,
    broken: bool,
    rate: u32,
    target_id: Option<&str>,
) -> bool {
    match opened {
        None => true,
        Some(opened) => {
            broken || opened.rate != rate || target_id.is_some_and(|id| id != opened.device_id)
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

/// What the output thread hears from the engine.
enum Control {
    Stop,
    /// Play on the device with this id; `None` follows the system's default.
    Choose(Option<String>),
}

#[derive(Default)]
struct Shown {
    /// The device playing, by the name the system gives it.
    device: Option<String>,
    outputs: Vec<OutputDevice>,
}

/// The output thread and what the engine reads from it.
pub struct Output {
    control: mpsc::Sender<Control>,
    shown: Arc<Mutex<Shown>>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Output {
    /// Starts playing `player` on the default device; `silent` keeps time without a device.
    pub fn start(player: Arc<Player>, silent: bool) -> Output {
        let (control, controls) = mpsc::channel();
        let shown = Arc::new(Mutex::new(Shown::default()));
        let shared = Arc::clone(&shown);
        let worker = thread::Builder::new()
            .name("wave-output".into())
            .spawn(move || run(&player, silent, &controls, &shared))
            .expect("starts the output thread");
        Output { control, shown, worker: Some(worker) }
    }

    fn shown(&self) -> MutexGuard<'_, Shown> {
        self.shown.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The device playing, by the name the system gives it.
    pub fn device(&self) -> Option<String> {
        self.shown().device.clone()
    }

    /// The outputs the system had at the last look, a second ago at most.
    pub fn outputs(&self) -> Vec<OutputDevice> {
        self.shown().outputs.clone()
    }

    /// Moves playback to the device with `id` while the system has it; `None`, or a device
    /// that is away, plays on the system's default. The song goes on from where it is.
    pub fn choose(&self, id: Option<String>) {
        let _ = self.control.send(Control::Choose(id));
    }
}

impl Drop for Output {
    fn drop(&mut self) {
        let _ = self.control.send(Control::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

struct Playing {
    _stream: cpal::Stream,
    opened: Opened,
    name: Option<String>,
    broken: Arc<AtomicBool>,
}

/// The system's outputs with the devices behind them.
fn present(host: &cpal::Host) -> Vec<(OutputDevice, cpal::Device)> {
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|device| {
            let id = device.id().ok()?.to_string();
            let name = device.description().ok()?.name().to_string();
            Some((OutputDevice { id, name }, device))
        })
        .collect()
}

fn run(
    player: &Arc<Player>,
    silent: bool,
    controls: &mpsc::Receiver<Control>,
    shown: &Mutex<Shown>,
) {
    let host = cpal::default_host();
    let mut playing: Option<Playing> = None;
    let mut last_check: Option<Instant> = None;
    let mut clock = Instant::now();
    let mut silence = Vec::new();
    let mut chosen: Option<String> = None;
    // A chosen device that wouldn't open counts as away until it leaves or the choice changes.
    let mut refused: Option<String> = None;
    loop {
        match controls.recv_timeout(TICK) {
            Ok(Control::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Ok(Control::Choose(id)) => {
                chosen = id;
                refused = None;
                // The move shouldn't wait for the next device check.
                last_check = None;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        let rate = player.progress().track.map_or(44_100, |track| track.sample_rate);
        if !silent && last_check.is_none_or(|at| at.elapsed() >= DEVICE_CHECK) {
            last_check = Some(Instant::now());
            let mut devices = present(&host);
            let outputs: Vec<OutputDevice> =
                devices.iter().map(|(output, _)| output.clone()).collect();
            if refused.as_ref().is_some_and(|id| outputs.iter().all(|output| output.id != *id)) {
                refused = None;
            }
            let default_id =
                host.default_output_device().and_then(|d| d.id().ok()).map(|id| id.to_string());
            let wanted = chosen.as_deref().filter(|id| refused.as_deref() != Some(*id));
            let target = target_device(wanted, &outputs, default_id.as_deref());
            let opened = playing.as_ref().map(|p| &p.opened);
            let broken = playing.as_ref().is_some_and(|p| p.broken.load(Ordering::Relaxed));
            let rebuilt = needs_rebuild(opened, broken, rate, target);
            if rebuilt {
                drop(playing.take());
                let at = wanted
                    .filter(|id| target == Some(*id))
                    .and_then(|id| devices.iter().position(|(output, _)| output.id == id));
                playing = at.and_then(|at| open(devices.swap_remove(at).1, player, rate));
                if playing.is_none() {
                    if at.is_some() {
                        refused = chosen.clone();
                    }
                    playing = host.default_output_device().and_then(|d| open(d, player, rate));
                }
                clock = Instant::now();
            }
            let mut shown = shown.lock().unwrap_or_else(|p| p.into_inner());
            if rebuilt {
                shown.device = playing.as_ref().and_then(|p| p.name.clone());
            }
            shown.outputs = outputs;
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

fn open(device: cpal::Device, player: &Arc<Player>, rate: u32) -> Option<Playing> {
    let device_id = device.id().ok()?.to_string();
    let name = device.description().ok().map(|d| d.name().to_string());
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
    Some(Playing { _stream: stream, opened: Opened { device_id, rate }, name, broken })
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
                    adapter.fill(out, |input| {
                        player.render(input, song_rate);
                    });
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

    fn outputs() -> Vec<OutputDevice> {
        ["wasapi:speakers", "wasapi:headphones"]
            .map(|id| OutputDevice { id: id.into(), name: id.into() })
            .to_vec()
    }

    #[test]
    fn playback_goes_to_the_chosen_device_while_the_system_has_it() {
        let default = Some("wasapi:speakers");
        assert_eq!(target_device(None, &outputs(), default), default);
        assert_eq!(
            target_device(Some("wasapi:headphones"), &outputs(), default),
            Some("wasapi:headphones")
        );
    }

    #[test]
    fn a_chosen_device_that_went_away_falls_back_to_the_default_and_returns() {
        let default = Some("wasapi:speakers");
        let unplugged = &outputs()[..1];
        assert_eq!(target_device(Some("wasapi:headphones"), unplugged, default), default);
        let opened = opened();
        assert!(!needs_rebuild(Some(&opened), false, 44_100, default));
        let back = target_device(Some("wasapi:headphones"), &outputs(), default);
        assert!(needs_rebuild(Some(&opened), false, 44_100, back), "plugged back: return to it");
        assert_eq!(target_device(Some("wasapi:headphones"), &[], None), None);
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
