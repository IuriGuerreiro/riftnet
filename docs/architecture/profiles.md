# Profiles and avatars

Backend: `services/api/src/features/users/`. Contract: `proto/v1/users.proto`.

## Fields

| Field          | Rule                                                        |
| -------------- | ----------------------------------------------------------- |
| `display_name` | 1–32 chars after trim, no control chars. `""` clears it.    |
| `bio`          | Up to 190 chars, newlines OK, no other control chars.       |
| `avatar_hash`  | Hex id of the current avatar (BLAKE3 of image + nonce). Null = none. |

## Endpoints

| Method + path                              | What                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| `PATCH /me`                                | `{ display_name?, bio? }`. Missing = keep, `""` = clear. One atomic update |
| `PUT /me/avatar`                           | Raw image body, max 8 MB. 10 per hour per user       |
| `DELETE /me/avatar`                        | Remove the avatar                                    |
| `GET /users/{id}`                          | A user's profile                                     |
| `GET /users/{id}/avatar/{hash}?size=128\|512` | `{ url }`: a 5-minute signed link (WebP)          |

All need a login. **Visibility:** user search already shows any user to any
logged-in user, so profiles and avatars are readable by any logged-in user.
Tighten both together if search ever gets restricted.

## Avatar pipeline

1. Type comes from the file's magic bytes: PNG, JPEG, WebP, GIF (first frame).
   Anything else (SVG, HEIC…) is rejected.
2. Decode limits: 4096 px per side, ~80 MB decode memory. Stops decompression
   bombs. At most 2 avatars are processed at once; when both slots are busy
   the upload gets 429 before its body is read.
3. Center-crop to square, resize to 128 and 512, re-encode as lossless WebP.
   Re-encoding from pixels drops EXIF, GPS and every other metadata.
4. Stored at `avatars/{user_id}/{hash}/{size}.webp` in the same S3 bucket as
   attachments (MinIO / R2). The attachment cleanup only reads its own table,
   so **avatars never expire**.
5. Every upload gets its own id (image hash + random nonce), so two uploads
   never share files. The DB swap returns the previous id; its files are
   deleted (best effort). Failed uploads delete their own files.

A new image always has a new hash, so clients can cache images by hash forever.

## Live updates

`UserUpdated` is pushed to the user, accepted friends and everyone they share
a conversation with (same audience as presence, `friends::audience`) when the
username, display name, bio or avatar changes.
