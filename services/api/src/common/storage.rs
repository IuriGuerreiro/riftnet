//! File store over the S3 API: MinIO locally, Cloudflare R2 in production.
//! Same code for both; only the endpoint and keys change.

use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use bytes::Bytes;

#[async_trait]
pub trait FileStore: Send + Sync {
    /// Starts a multipart upload. Returns its upload id.
    async fn start_upload(&self, key: &str, content_type: &str) -> anyhow::Result<String>;
    /// Stores one part. `part` is 0-based. Returns the part's etag.
    async fn put_part(
        &self,
        key: &str,
        upload_id: &str,
        part: u32,
        data: Bytes,
    ) -> anyhow::Result<String>;
    /// Joins the parts (etags in part order) into the final object.
    async fn finish_upload(
        &self,
        key: &str,
        upload_id: &str,
        etags: &[String],
    ) -> anyhow::Result<()>;
    /// Parts S3 actually holds, in order: (0-based part, etag, size).
    async fn list_parts(
        &self,
        key: &str,
        upload_id: &str,
    ) -> anyhow::Result<Vec<(u32, String, i64)>>;
    async fn abort_upload(&self, key: &str, upload_id: &str) -> anyhow::Result<()>;
    /// Size of a finished object, None if it doesn't exist.
    async fn object_size(&self, key: &str) -> anyhow::Result<Option<i64>>;
    async fn delete(&self, key: &str) -> anyhow::Result<()>;
    /// A short-lived link anyone holding it can download from.
    async fn download_url(
        &self,
        key: &str,
        filename: &str,
        ttl: Duration,
    ) -> anyhow::Result<String>;
    /// A short-lived link the browser shows inline (for <img>/<video>).
    async fn preview_url(
        &self,
        key: &str,
        content_type: &str,
        ttl: Duration,
    ) -> anyhow::Result<String>;
}

pub struct S3Config<'a> {
    pub endpoint: &'a str,
    /// Host put in download links, when browsers reach S3 by another address.
    pub public_endpoint: Option<&'a str>,
    pub region: &'a str,
    pub bucket: &'a str,
    pub access_key: &'a str,
    pub secret_key: &'a str,
}

pub struct S3FileStore {
    client: Client,
    presigner: Client,
    bucket: String,
}

impl S3FileStore {
    pub fn new(cfg: &S3Config<'_>) -> Self {
        let client_for = |endpoint: &str| {
            let creds = Credentials::new(cfg.access_key, cfg.secret_key, None, None, "config");
            let conf = aws_sdk_s3::Config::builder()
                .behavior_version(BehaviorVersion::latest())
                .endpoint_url(endpoint)
                .region(Region::new(cfg.region.to_string()))
                .credentials_provider(creds)
                // MinIO needs bucket-in-path; R2 accepts it too.
                .force_path_style(true)
                .build();
            Client::from_conf(conf)
        };
        Self {
            client: client_for(cfg.endpoint),
            presigner: client_for(cfg.public_endpoint.unwrap_or(cfg.endpoint)),
            bucket: cfg.bucket.to_string(),
        }
    }

    /// Dev only: create the bucket if it's missing, so a fresh MinIO just works.
    pub async fn ensure_bucket(&self) -> anyhow::Result<()> {
        if self
            .client
            .head_bucket()
            .bucket(&self.bucket)
            .send()
            .await
            .is_ok()
        {
            return Ok(());
        }
        self.client
            .create_bucket()
            .bucket(&self.bucket)
            .send()
            .await
            .context("create bucket")?;
        Ok(())
    }
}

#[async_trait]
impl FileStore for S3FileStore {
    async fn start_upload(&self, key: &str, content_type: &str) -> anyhow::Result<String> {
        let out = self
            .client
            .create_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .send()
            .await
            .context("s3 create multipart upload")?;
        out.upload_id.context("s3 returned no upload id")
    }

    async fn put_part(
        &self,
        key: &str,
        upload_id: &str,
        part: u32,
        data: Bytes,
    ) -> anyhow::Result<String> {
        let out = self
            .client
            .upload_part()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id)
            .part_number(part as i32 + 1) // S3 parts are 1-based
            .body(ByteStream::from(data))
            .send()
            .await
            .context("s3 upload part")?;
        out.e_tag.context("s3 returned no etag")
    }

    async fn finish_upload(
        &self,
        key: &str,
        upload_id: &str,
        etags: &[String],
    ) -> anyhow::Result<()> {
        let parts = etags
            .iter()
            .enumerate()
            .map(|(i, etag)| {
                CompletedPart::builder()
                    .part_number(i as i32 + 1)
                    .e_tag(etag)
                    .build()
            })
            .collect();
        self.client
            .complete_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id)
            .multipart_upload(
                CompletedMultipartUpload::builder()
                    .set_parts(Some(parts))
                    .build(),
            )
            .send()
            .await
            .context("s3 complete multipart upload")?;
        Ok(())
    }

    async fn list_parts(
        &self,
        key: &str,
        upload_id: &str,
    ) -> anyhow::Result<Vec<(u32, String, i64)>> {
        let mut out = Vec::new();
        let mut marker: Option<String> = None;
        loop {
            let page = self
                .client
                .list_parts()
                .bucket(&self.bucket)
                .key(key)
                .upload_id(upload_id)
                .set_part_number_marker(marker.take())
                .send()
                .await
                .context("s3 list parts")?;
            for p in page.parts() {
                let n = p.part_number().context("part without number")?;
                let etag = p.e_tag().context("part without etag")?;
                out.push(((n - 1) as u32, etag.to_string(), p.size().unwrap_or(0)));
            }
            if page.is_truncated() != Some(true) {
                break;
            }
            marker = page.next_part_number_marker().map(String::from);
            if marker.is_none() {
                break;
            }
        }
        out.sort_by_key(|(n, _, _)| *n);
        Ok(out)
    }

    async fn object_size(&self, key: &str) -> anyhow::Result<Option<i64>> {
        match self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
        {
            Ok(out) => Ok(Some(out.content_length().unwrap_or(0))),
            Err(err) if err.as_service_error().is_some_and(|e| e.is_not_found()) => Ok(None),
            Err(err) => Err(anyhow::Error::from(err).context("s3 head object")),
        }
    }

    async fn abort_upload(&self, key: &str, upload_id: &str) -> anyhow::Result<()> {
        self.client
            .abort_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id)
            .send()
            .await
            .context("s3 abort multipart upload")?;
        Ok(())
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .context("s3 delete object")?;
        Ok(())
    }

    async fn download_url(
        &self,
        key: &str,
        filename: &str,
        ttl: Duration,
    ) -> anyhow::Result<String> {
        let req = self
            .presigner
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .response_content_disposition(content_disposition(filename))
            .presigned(PresigningConfig::expires_in(ttl)?)
            .await
            .context("s3 presign get")?;
        Ok(req.uri().to_string())
    }

    async fn preview_url(
        &self,
        key: &str,
        content_type: &str,
        ttl: Duration,
    ) -> anyhow::Result<String> {
        let req = self
            .presigner
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .response_content_type(content_type)
            .response_content_disposition("inline")
            .presigned(PresigningConfig::expires_in(ttl)?)
            .await
            .context("s3 presign preview")?;
        Ok(req.uri().to_string())
    }
}

/// `attachment; filename*=UTF-8''<percent-encoded>` so any filename is safe in a header.
fn content_disposition(filename: &str) -> String {
    let mut encoded = String::new();
    for b in filename.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            encoded.push(b as char);
        } else {
            encoded.push_str(&format!("%{b:02X}"));
        }
    }
    format!("attachment; filename*=UTF-8''{encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_disposition_encodes_unsafe_bytes() {
        assert_eq!(
            content_disposition("a b\"é.txt"),
            "attachment; filename*=UTF-8''a%20b%22%C3%A9.txt"
        );
    }
}

/// Needs MinIO: `docker compose -f infra/docker-compose.yml up -d minio`,
/// then `cargo test -p api -- --ignored minio`.
#[cfg(test)]
mod minio_tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn minio_multipart_roundtrip() {
        let store = S3FileStore::new(&S3Config {
            endpoint: "http://127.0.0.1:7106",
            public_endpoint: None,
            region: "auto",
            bucket: "attachments-test",
            access_key: "minio",
            secret_key: "minio-dev-secret",
        });
        store.ensure_bucket().await.unwrap();
        let key = "test/roundtrip";
        let id = store.start_upload(key, "text/plain").await.unwrap();
        let big = Bytes::from(vec![1u8; 5 * 1024 * 1024]);
        let e0 = store.put_part(key, &id, 0, big.clone()).await.unwrap();
        let e1 = store
            .put_part(key, &id, 1, Bytes::from_static(b"tail"))
            .await
            .unwrap();
        let parts = store.list_parts(key, &id).await.unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!((parts[0].0, parts[1].0, parts[1].2), (0, 1, 4));
        assert_eq!(store.object_size(key).await.unwrap(), None);
        store.finish_upload(key, &id, &[e0, e1]).await.unwrap();

        assert_eq!(
            store.object_size(key).await.unwrap(),
            Some(big.len() as i64 + 4)
        );
        let url = store
            .download_url(key, "a b.txt", Duration::from_secs(60))
            .await
            .unwrap();
        let resp = reqwest::get(&url).await.unwrap();
        assert!(
            resp.headers()["content-disposition"]
                .to_str()
                .unwrap()
                .contains("a%20b.txt")
        );
        let body = resp.bytes().await.unwrap();
        assert_eq!(body.len(), big.len() + 4);
        store.delete(key).await.unwrap();

        let id = store
            .start_upload("test/aborted", "text/plain")
            .await
            .unwrap();
        store.abort_upload("test/aborted", &id).await.unwrap();
    }
}
