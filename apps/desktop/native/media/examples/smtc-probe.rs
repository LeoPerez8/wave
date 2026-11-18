//! An OS-side probe for e2e/system.spec.ts. It controls the published SMTC session.
#[cfg(windows)]
fn main() -> windows::core::Result<()> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    let args: Vec<_> = std::env::args().collect();
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.join()?;
    for session in manager.GetSessions()? {
        let properties = session.TryGetMediaPropertiesAsync()?.join()?;
        if properties.Title()? != args[1] {
            continue;
        }
        let accepted = match args[2].as_str() {
            "pause" => session.TryPauseAsync()?.join()?,
            "play" => session.TryPlayAsync()?.join()?,
            "next" => session.TrySkipNextAsync()?.join()?,
            "previous" => session.TrySkipPreviousAsync()?.join()?,
            "seek" => session.TryChangePlaybackPositionAsync(50_000_000)?.join()?,
            _ => {
                let timeline = session.GetTimelineProperties()?;
                let cover = properties.Thumbnail().is_ok_and(|image| {
                    image.OpenReadAsync().is_ok_and(|read| {
                        read.join().is_ok_and(|stream| stream.Size().unwrap_or(0) > 0)
                    })
                });
                println!(
                    "{}|{}|{}|{}|cover={}",
                    properties.Title()?,
                    properties.Artist()?,
                    properties.AlbumTitle()?,
                    timeline.EndTime()?.Duration / 10_000,
                    cover
                );
                true
            }
        };
        assert!(accepted, "OS refused the command");
        return Ok(());
    }
    panic!("No SMTC session for {}", args[1]);
}

#[cfg(not(windows))]
fn main() {}
