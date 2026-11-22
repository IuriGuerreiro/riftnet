# Profiles, avatars and banners

Backend: `services/api/src/features/users/`. Contract: `proto/v1/users.proto`.

## Fields

| Field          | Rule                                                        |
| -------------- | ----------------------------------------------------------- |
| `display_name` | 1–32 chars after trim, no control chars. `""` clears it.    |
| `custom_status` | Up to 128 characters after trim; no control characters. `""` clears it. |
| `bio`          | Up to 190 chars, newlines OK, no other control chars.       |
| `avatar_hash`  | Hex id of the current avatar (BLAKE3 of image + nonce). Null = none. |
| `banner_hash`  | Same as `avatar_hash`, for the profile banner.               |
| `accent_color` | `"#rrggbb"` (stored as an integer). Tints the card. `""` clears it. |
| `pronouns`     | Up to 40 chars after trim, no control chars. `""` clears it. |

## Endpoints

| Method + path                              | What                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| `PATCH /me`                                | `{ display_name?, bio?, custom_status?, pronouns?, accent_color? }`. Missing = keep, `""` = clear. One atomic update |
| `PUT /me/avatar`                           | Raw image body, max 8 MB                             |
| `DELETE /me/avatar`                        | Remove the avatar                                    |
| `PUT /me/banner`                           | Raw image body, max 8 MB                             |
| `DELETE /me/banner`                        | Remove the banner                                    |
| `GET /users/{id}`                          | A user's profile                                     |
| `GET /users/{id}/avatar/{hash}?size=128\|512` | `{ url }`: a 5-minute signed link (WebP)          |
| `GET /users/{id}/banner/{hash}`            | `{ url }`: a 5-minute signed link (WebP, 960x384)    |

Avatar and banner uploads share one limit: 10 per hour per user.

All need a login. **Visibility:** user search already shows any user to any
logged-in user, so profiles and avatars are readable by any logged-in user.
Tighten both together if search ever gets restricted.

## Image pipeline (avatar and banner)

Code: `services/api/src/features/users/image.rs`.

1. Type comes from the file's magic bytes: PNG, JPEG, WebP, GIF (first frame).
   Anything else (SVG, HEIC…) is rejected.
2. Decode limits: 4096 px per side, ~80 MB decode memory. Stops decompression
   bombs. At most 2 images (avatars and banners together) are processed at once; when both slots are busy
   the upload gets 429 before its body is read.
3. Center-crop to the target shape and re-encode as lossless WebP.
   Avatar: square, 128 and 512 px. Banner: 5:2, 960x384.
   Re-encoding from pixels drops EXIF, GPS and every other metadata.
4. Stored at `avatars/{user_id}/{hash}/{width}.webp` or
   `banners/{user_id}/{hash}/{width}.webp` in the same S3 bucket as
   attachments (MinIO / R2). The attachment cleanup only reads its own table,
   so **these images never expire**.
5. Every upload gets its own id (image hash + random nonce), so two uploads
   never share files. The DB swap returns the previous id; its files are
   deleted (best effort). Failed uploads delete their own files.

A new image always has a new hash, so clients can cache images by hash forever.

## Live updates

`UserUpdated` is pushed to the user, accepted friends and everyone they share
a conversation with (same audience as presence, `friends::audience`) when the
username, display name, bio, custom status, avatar, banner, accent color or
pronouns changes.

## Profile card (client)

Clicking an avatar or name in chat, the member list or the DM header opens a
floating card (`client/src/features/profile/`). It shows the banner (or the
accent color), avatar, name, @username, pronouns, status and bio. One
`ProfileCardHost` is mounted in `routes/home.tsx`; `ProfileTrigger` wraps
anything that should open it. Users not in the profile store yet (such as
server members) are loaded with `GET /users/{id}`.

Edit profile shows the same card as a live preview of unsaved changes.

Presence controls and private notification preferences are described in [user settings](user-settings.md).
