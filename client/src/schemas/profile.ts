import { z } from "zod";

// INVARIANT: same limits as the server (services/api users/service.rs).
export const MAX_DISPLAY_NAME = 32;
export const MAX_BIO = 190;
export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// eslint-disable-next-line no-control-regex
const controlChars = /[\u0000-\u001f\u007f-\u009f]/;
// eslint-disable-next-line no-control-regex
const controlNoNewline = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

export const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(MAX_DISPLAY_NAME, `At most ${MAX_DISPLAY_NAME} characters`)
    .refine((s) => !controlChars.test(s), "No special control characters"),
  bio: z
    .string()
    .trim()
    .max(MAX_BIO, `At most ${MAX_BIO} characters`)
    .refine((s) => !controlNoNewline.test(s), "No special control characters"),
});
export type ProfileForm = z.infer<typeof profileSchema>;

export function avatarFileProblem(file: { type: string; size: number }): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return "Pick a PNG, JPEG, WebP or GIF image";
  if (file.size > MAX_AVATAR_BYTES) return "Image must be 8 MB or less";
  if (file.size === 0) return "That file is empty";
  return null;
}
