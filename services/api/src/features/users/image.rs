use std::io::Cursor;

use bytes::Bytes;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, ImageReader, Limits};

use crate::common::error::ApiError;

pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
pub const IMAGE_CONTENT_TYPE: &str = "image/webp";
const MAX_SIDE: u32 = 4096;
// WARN: decoder memory cap. 4096 x 4096 RGBA (64 MiB) plus slack; the crop copies at most that again, so one image peaks around 150 MiB.
const MAX_DECODE_ALLOC: u64 = 80 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileImage {
    Avatar,
    Banner,
}

impl ProfileImage {
    // INVARIANT: smallest first, one aspect ratio; the last size is hashed.
    pub fn sizes(self) -> &'static [(u32, u32)] {
        match self {
            Self::Avatar => &[(128, 128), (512, 512)],
            Self::Banner => &[(960, 384)],
        }
    }

    pub fn widths(self) -> impl Iterator<Item = u32> {
        self.sizes().iter().map(|&(w, _)| w)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Avatar => "avatar",
            Self::Banner => "banner",
        }
    }

    pub fn key(self, user_id: i64, hash_hex: &str, width: u32) -> String {
        let dir = match self {
            Self::Avatar => "avatars",
            Self::Banner => "banners",
        };
        format!("{dir}/{user_id}/{hash_hex}/{width}.webp")
    }
}

#[derive(Debug)]
pub struct ProcessedImage {
    pub hash: [u8; 32],
    pub files: Vec<(u32, Bytes)>,
}

pub fn process(kind: ProfileImage, data: &[u8]) -> Result<ProcessedImage, ApiError> {
    if data.is_empty() {
        return Err(ApiError::bad_request("empty_file", "file is empty"));
    }
    if data.len() > MAX_IMAGE_BYTES {
        return Err(ApiError::bad_request(
            "file_too_large",
            format!("{} must be 8 MB or less", kind.name()),
        ));
    }
    let img = decode(kind, data)?;

    let &(tw, th) = kind.sizes().last().expect("at least one size");
    let (iw, ih) = (u64::from(img.width()), u64::from(img.height()));
    let cw = iw.min(ih * u64::from(tw) / u64::from(th)) as u32;
    let ch = ih.min(iw * u64::from(th) / u64::from(tw)) as u32;
    if cw == 0 || ch == 0 {
        return Err(not_an_image(kind));
    }
    let x = (img.width() - cw) / 2;
    let y = (img.height() - ch) / 2;
    let cropped = DynamicImage::ImageRgba8(img.crop_imm(x, y, cw, ch).to_rgba8());

    let mut files = Vec::with_capacity(kind.sizes().len());
    for &(w, h) in kind.sizes() {
        let resized = cropped.resize_exact(w, h, FilterType::Lanczos3);
        let mut out = Vec::new();
        resized
            .write_with_encoder(image::codecs::webp::WebPEncoder::new_lossless(&mut out))
            .map_err(|e| ApiError::Internal(anyhow::Error::from(e).context("encode image")))?;
        files.push((w, Bytes::from(out)));
    }
    let largest = &files.last().expect("at least one size").1;
    Ok(ProcessedImage {
        hash: *blake3::hash(largest).as_bytes(),
        files,
    })
}

fn decode(kind: ProfileImage, data: &[u8]) -> Result<DynamicImage, ApiError> {
    let mut reader = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|_| not_an_image(kind))?;
    match reader.format() {
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Gif) => {}
        _ => return Err(not_an_image(kind)),
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    reader.decode().map_err(|_| not_an_image(kind))
}

fn not_an_image(kind: ProfileImage) -> ApiError {
    ApiError::bad_request(
        "invalid_image",
        format!("{} must be a PNG, JPEG, WebP or GIF image", kind.name()),
    )
}

#[cfg(test)]
pub mod tests {
    use super::*;

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

        let out = process(ProfileImage::Avatar, &src).unwrap();
        assert_eq!(out.files.len(), 2);
        for (size, bytes) in &out.files {
            assert!(!bytes.windows(15).any(|w| w == b"SECRET-LOCATION"));
            let img = image::load_from_memory_with_format(bytes, ImageFormat::WebP).unwrap();
            assert_eq!((img.width(), img.height()), (*size, *size));
        }
        assert_eq!(out.hash, *blake3::hash(&out.files[1].1).as_bytes());
    }

    #[test]
    fn banner_is_cropped_to_5_by_2() {
        for (w, h) in [(300, 300), (2000, 200), (100, 40)] {
            let out = process(ProfileImage::Banner, &png(w, h)).unwrap();
            assert_eq!(out.files.len(), 1);
            let (width, bytes) = &out.files[0];
            assert_eq!(*width, 960);
            let img = image::load_from_memory_with_format(bytes, ImageFormat::WebP).unwrap();
            assert_eq!((img.width(), img.height()), (960, 384));
        }
    }

    #[test]
    fn keys_per_kind() {
        assert_eq!(
            ProfileImage::Avatar.key(7, "ab", 128),
            "avatars/7/ab/128.webp"
        );
        assert_eq!(
            ProfileImage::Banner.key(7, "ab", 960),
            "banners/7/ab/960.webp"
        );
    }

    #[test]
    fn same_image_same_hash() {
        let src = png(64, 64);
        assert_eq!(
            process(ProfileImage::Avatar, &src).unwrap().hash,
            process(ProfileImage::Avatar, &src).unwrap().hash
        );
    }

    #[test]
    fn rejects_non_images_and_big_files() {
        assert!(process(ProfileImage::Avatar, b"").is_err());
        assert!(
            process(
                ProfileImage::Avatar,
                b"<svg xmlns='http://www.w3.org/2000/svg'/>"
            )
            .is_err()
        );
        assert!(process(ProfileImage::Avatar, b"GIF89a-but-truncated").is_err());
        let err = process(ProfileImage::Banner, &vec![0u8; MAX_IMAGE_BYTES + 1]).unwrap_err();
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
        let src = png(1, 1);
        let mut bomb = src.clone();
        bomb[16..20].copy_from_slice(&5_000u32.to_be_bytes());
        bomb[20..24].copy_from_slice(&5_000u32.to_be_bytes());
        let crc = crc32(&bomb[12..29]);
        bomb[29..33].copy_from_slice(&crc.to_be_bytes());
        assert!(process(ProfileImage::Avatar, &bomb).is_err());
        assert!(process(ProfileImage::Banner, &bomb).is_err());
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
