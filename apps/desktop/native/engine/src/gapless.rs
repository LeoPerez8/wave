//! AAC trim metadata. Only the bounded `moov` box is read; audio bytes stay streamed.
use std::io::{Read, Seek, SeekFrom};

#[derive(Clone, Copy, Debug)]
pub struct Trim {
    pub delay: u64,
    pub frames: u64,
}

fn u32_at(d: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(d.get(at..at + 4)?.try_into().ok()?))
}
fn u64_at(d: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(d.get(at..at + 8)?.try_into().ok()?))
}
fn boxes(mut d: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    std::iter::from_fn(move || {
        let size = u32_at(d, 0)?;
        let (size, header) = match size {
            0 => (d.len(), 8),
            1 => (usize::try_from(u64_at(d, 8)?).ok()?, 16),
            n => (n as usize, 8),
        };
        if size < header || size > d.len() {
            return None;
        }
        let out = (d.get(4..8)?, d.get(header..size)?);
        d = &d[size..];
        Some(out)
    })
}
fn child<'a>(d: &'a [u8], kind: &[u8]) -> Option<&'a [u8]> {
    boxes(d).find(|(k, _)| *k == kind).map(|(_, v)| v)
}
pub fn smpb(text: &str, encoded_frames: Option<u64>, scale: u64) -> Option<Trim> {
    let mut fields = text.split_whitespace().skip(1);
    let delay = u64::from_str_radix(fields.next()?, 16).ok()?;
    let padding = u64::from_str_radix(fields.next()?, 16).ok()?;
    let frames = u64::from_str_radix(fields.next()?, 16).ok()?;
    let total = delay.checked_add(frames)?.checked_add(padding)?;
    // HE-AAC tags usually count core samples. A tag that already accounts for every
    // output frame uses output samples.
    let scale = if encoded_frames == Some(total) { 1 } else { scale };
    total.checked_mul(scale)?;
    let frames = frames * scale;
    let delay = delay * scale;
    (frames > 0).then_some(Trim { delay, frames })
}
fn timescale(d: &[u8]) -> Option<u64> {
    let offset = if *d.first()? == 1 { 20 } else { 12 };
    let scale = u32_at(d, offset)? as u64;
    (scale > 0).then_some(scale)
}
fn edits(moov: &[u8], track_id: u32, rate: u32) -> Option<Trim> {
    let movie_scale = timescale(child(moov, b"mvhd")?)?;
    for (_, trak) in boxes(moov).filter(|(k, _)| *k == b"trak") {
        let tkhd = child(trak, b"tkhd")?;
        let id_offset = if *tkhd.first()? == 1 { 20 } else { 12 };
        if u32_at(tkhd, id_offset)? != track_id {
            continue;
        }
        let mdia = child(trak, b"mdia")?;
        if child(mdia, b"hdlr")?.get(8..12)? != b"soun" {
            continue;
        }
        let media_scale = timescale(child(mdia, b"mdhd")?)?;
        let elst = child(child(trak, b"edts")?, b"elst")?;
        // Multiple edits splice the media timeline; they cannot be represented by one trim.
        if u32_at(elst, 4)? != 1 {
            return None;
        }
        let (duration, delay, rate_offset) = match *elst.first()? {
            0 => (u32_at(elst, 8)? as u64, u32_at(elst, 12)? as i32 as i64, 16),
            1 => (u64_at(elst, 8)?, u64_at(elst, 16)? as i64, 24),
            _ => return None,
        };
        if delay < 0 || u32_at(elst, rate_offset)? != 0x00010000 {
            return None;
        }
        let frames = u64::try_from(duration as u128 * rate as u128 / movie_scale as u128).ok()?;
        let delay = u64::try_from(delay as u128 * rate as u128 / media_scale as u128).ok()?;
        delay.checked_add(frames)?;
        return (frames > 0).then_some(Trim { delay, frames });
    }
    None
}
/// The trim from an MP4's edit list, read from any seekable reader of `length` bytes, such as
/// a song still downloading.
pub fn from_mp4_reader<R: Read + Seek>(
    mut file: R,
    length: u64,
    track_id: u32,
    rate: u32,
) -> Option<Trim> {
    let mut offset = 0u64;
    while offset.checked_add(8)? <= length {
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut header = [0; 8];
        file.read_exact(&mut header).ok()?;
        let size = u32_at(&header, 0)?;
        let (size, header_size) = match size {
            0 => (length - offset, 8),
            1 => {
                let mut extended = [0; 8];
                file.read_exact(&mut extended).ok()?;
                (u64::from_be_bytes(extended), 16)
            }
            n => (n as u64, 8),
        };
        if size < header_size || offset.checked_add(size)? > length {
            return None;
        }
        if &header[4..8] == b"moov" {
            let len = size - header_size;
            if len > 32 * 1024 * 1024 {
                return None;
            }
            let mut data = vec![0; len as usize];
            file.read_exact(&mut data).ok()?;
            return edits(&data, track_id, rate);
        }
        offset += size;
    }
    None
}
