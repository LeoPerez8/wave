use napi::{Error, Result};
use napi_derive::napi;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[napi(object)]
pub struct MediaEvent {
    pub action: String,
    pub value: Option<f64>,
}

fn media_event(event: MediaControlEvent) -> Option<MediaEvent> {
    let sign = |direction| match direction {
        SeekDirection::Forward => 1.0,
        SeekDirection::Backward => -1.0,
    };
    let (action, value) = match event {
        MediaControlEvent::Play => ("play", None),
        MediaControlEvent::Pause | MediaControlEvent::Stop => ("pause", None),
        MediaControlEvent::Toggle => ("toggle", None),
        MediaControlEvent::Next => ("next", None),
        MediaControlEvent::Previous => ("previous", None),
        MediaControlEvent::Raise => ("raise", None),
        MediaControlEvent::Quit => ("quit", None),
        MediaControlEvent::SetPosition(position) => {
            ("seek", Some(position.0.as_secs_f64() * 1000.0))
        }
        MediaControlEvent::SeekBy(direction, amount) => {
            ("seekBy", Some(sign(direction) * amount.as_secs_f64() * 1000.0))
        }
        MediaControlEvent::Seek(direction) => ("seekBy", Some(sign(direction) * 10_000.0)),
        _ => return None,
    };
    Some(MediaEvent { action: action.into(), value })
}

/// MPRIS for Electron's main process. Windows uses Chromium's Media Session instead (#1157),
/// so there this refuses to start: it passes no window handle.
#[napi]
pub struct SystemMedia {
    controls: Option<MediaControls>,
    events: Arc<Mutex<VecDeque<MediaEvent>>>,
}

fn refused(error: impl std::fmt::Display) -> Error {
    Error::from_reason(format!("[system-media] {error}"))
}

#[napi]
impl SystemMedia {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let mut controls = MediaControls::new(PlatformConfig {
            dbus_name: "wave",
            display_name: "Wave",
            hwnd: None,
        })
        .map_err(refused)?;
        let events = Arc::new(Mutex::new(VecDeque::new()));
        let received = events.clone();
        controls
            .attach(move |event| {
                if let Some(event) = media_event(event)
                    && let Ok(mut events) = received.lock()
                {
                    if events.len() == 64 {
                        events.pop_front();
                    }
                    events.push_back(event);
                }
            })
            .map_err(refused)?;
        Ok(Self { controls: Some(controls), events })
    }

    #[napi]
    pub fn metadata(
        &mut self,
        title: String,
        artist: String,
        album: String,
        cover_url: String,
        duration_ms: f64,
    ) -> Result<()> {
        let controls = self.controls.as_mut().ok_or_else(|| refused("Closed"))?;
        controls
            .set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: Some(&album),
                cover_url: Some(&cover_url),
                duration: Some(Duration::from_secs_f64(duration_ms.max(0.0) / 1000.0)),
            })
            .map_err(refused)
    }

    #[napi]
    pub fn playback(&mut self, state: String, position_ms: f64) -> Result<()> {
        let progress = Some(MediaPosition(Duration::from_secs_f64(position_ms.max(0.0) / 1000.0)));
        let state = match state.as_str() {
            "playing" => MediaPlayback::Playing { progress },
            "paused" => MediaPlayback::Paused { progress },
            _ => MediaPlayback::Stopped,
        };
        self.controls
            .as_mut()
            .ok_or_else(|| refused("Closed"))?
            .set_playback(state)
            .map_err(refused)
    }

    #[napi]
    pub fn drain(&self) -> Vec<MediaEvent> {
        self.events.lock().map(|mut events| events.drain(..).collect()).unwrap_or_default()
    }

    #[napi]
    pub fn close(&mut self) {
        self.controls.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use souvlaki::{MediaControlEvent, MediaPosition, SeekDirection};
    use std::time::Duration;

    #[test]
    fn media_commands_keep_absolute_and_relative_seek_distinct() {
        let absolute =
            media_event(MediaControlEvent::SetPosition(MediaPosition(Duration::from_secs(42))))
                .unwrap();
        assert_eq!(absolute.action, "seek");
        assert_eq!(absolute.value, Some(42_000.0));
        let relative =
            media_event(MediaControlEvent::SeekBy(SeekDirection::Backward, Duration::from_secs(8)))
                .unwrap();
        assert_eq!(relative.action, "seekBy");
        assert_eq!(relative.value, Some(-8_000.0));
        assert_eq!(media_event(MediaControlEvent::Raise).unwrap().action, "raise");
        assert_eq!(media_event(MediaControlEvent::Quit).unwrap().action, "quit");
    }
}
