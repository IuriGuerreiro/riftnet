//! Avatar images: check, square-crop, resize and re-encode.
//! Re-encoding from raw pixels drops all metadata (EXIF, GPS, ICC, comments).

use std::io::Cursor;

use bytes::Bytes;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, ImageReader, Limits};

use crate::common::error::ApiError;

/// Biggest upload accepted.
pub const MAX_AVATAR_BYTES: usize = 8 * 1024 * 1024;
/// Sizes stored, in px (square). The last one is hashed for the avatar id.
pub const AVATAR_SIZES: [u32; 2] = [128, 512];
pub const AVATAR_CONTENT_TYPE: &str = "image/webp";
/// Biggest source image accepted, per side.
const MAX_SIDE: u32 = 8192;
/// Memory the decoder may use: 8192 x 8192 RGBA plus some slack.
const MAX_DECODE_ALLOC: u64 = 300 * 1024 * 1024;

#[derive(Debug)]
pub struct ProcessedAvatar {
    /// BLAKE3 of the largest size.
    pub hash: [u8; 32],
    /// (size in px, WebP bytes), same order as AVATAR_SIZES.
    pub files: Vec<(u32, Bytes)>,
}

/// CPU heavy: run it in `spawn_blocking`.
pub fn process(data: &[u8]) -> Result<ProcessedAvatar, ApiError> {
    if data.is_empty() {
        return Err(ApiError::bad_request("empty_file", "file is empty"));
    }
    if data.len() > MAX_AVATAR_BYTES {
        return Err(ApiError::bad_request(
            "file_too_large",
            "avatar must be 8 MB or less",
        ));
    }
    let img = decode(data)?;

    let side = img.width().min(img.height());
    if side == 0 {
        return Err(not_an_image());
    }
    let x = (img.width() - side) / 2;
    let y = (img.height() - side) / 2;
    let square = DynamicImage::ImageRgba8(img.crop_imm(x, y, side, side).to_rgba8());

    let mut files = Vec::with_capacity(AVATAR_SIZES.len());
    for size in AVATAR_SIZES {
        let resized = square.resize_exact(size, size, FilterType::Lanczos3);
        let mut out = Vec::new();
        resized
            .write_with_encoder(image::codecs::webp::WebPEncoder::new_lossless(&mut out))
            .map_err(|e| ApiError::Internal(anyhow::Error::from(e).context("encode avatar")))?;
        files.push((size, Bytes::from(out)));
    }
    let largest = &files.last().expect("at least one size").1;
    Ok(ProcessedAvatar {
        hash: *blake3::hash(largest).as_bytes(),
        files,
    })
}

fn decode(data: &[u8]) -> Result<DynamicImage, ApiError> {
    let mut reader = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|_| not_an_image())?;
    // The format comes from the file's magic bytes, never from the client.
    match reader.format() {
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Gif) => {}
        _ => return Err(not_an_image()),
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    // GIF: decode() returns the first frame only.
    reader.decode().map_err(|_| not_an_image())
}

fn not_an_image() -> ApiError {
    ApiError::bad_request(
        "invalid_image",
        "avatar must be a PNG, JPEG, WebP or GIF image",
    )
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A `w` x `h` PNG with a text chunk standing in for metadata.
    pub fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_fn(w, h, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, 90, 255])
        });
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            enc.add_text_chunk("GPS".into(), "SECRET-LOCATION".into())
                .unwrap();
            let mut writer = enc.write_header().unwrap();
            writer.write_image_data(&img).unwrap();
        }
        out
    }

    #[test]
    fn makes_square_webp_sizes_without_metadata() {
        let src = png(300, 200);
        assert!(src.windows(15).any(|w| w == b"SECRET-LOCATION"));

        let out = process(&src).unwrap();
        assert_eq!(out.files.len(), 2);
        for (size, bytes) in &out.files {
            assert!(!bytes.windows(15).any(|w| w == b"SECRET-LOCATION"));
            let img = image::load_from_memory_with_format(bytes, ImageFormat::WebP).unwrap();
            assert_eq!((img.width(), img.height()), (*size, *size));
        }
        assert_eq!(out.hash, *blake3::hash(&out.files[1].1).as_bytes());
    }

    #[test]
    fn same_image_same_hash() {
        let src = png(64, 64);
        assert_eq!(process(&src).unwrap().hash, process(&src).unwrap().hash);
    }

    #[test]
    fn rejects_non_images_and_big_files() {
        assert!(process(b"").is_err());
        assert!(process(b"<svg xmlns='http://www.w3.org/2000/svg'/>").is_err());
        assert!(process(b"GIF89a-but-truncated").is_err());
        let err = process(&vec![0u8; MAX_AVATAR_BYTES + 1]).unwrap_err();
        assert!(matches!(
            err,
            ApiError::BadRequest {
                code: "file_too_large",
                ..
            }
        ));
    }

    #[test]
    fn rejects_huge_dimensions() {
        // Tiny file, huge declared size: a decompression bomb.
        let src = png(1, 1);
        let mut bomb = src.clone();
        // IHDR width/height live at bytes 16..24; fix the CRC after.
        bomb[16..20].copy_from_slice(&100_000u32.to_be_bytes());
        bomb[20..24].copy_from_slice(&100_000u32.to_be_bytes());
        let crc = crc32(&bomb[12..29]);
        bomb[29..33].copy_from_slice(&crc.to_be_bytes());
        assert!(process(&bomb).is_err());
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for &b in data {
            crc ^= b as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }
}
