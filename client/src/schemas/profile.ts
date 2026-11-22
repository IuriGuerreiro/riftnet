import { z } from "zod";

// INVARIANT: same limits as the server (services/api users/service.rs).
export const MAX_DISPLAY_NAME = 32;
export const MAX_BIO = 190;
export const MAX_PRONOUNS = 40;
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
    .max(MAX_DISPLAY_NAME, `Must be ${MAX_DISPLAY_NAME} characters or fewer`)
    .refine((s) => !controlChars.test(s), "Cannot contain control characters"),
  custom_status: z
    .string()
    .trim()
    .max(128, "Must be 128 characters or fewer")
    .refine((s) => !controlChars.test(s), "Cannot contain control characters")
    .optional(),
  bio: z
    .string()
    .trim()
    .max(MAX_BIO, `Must be ${MAX_BIO} characters or fewer`)
    .refine((s) => !controlNoNewline.test(s), "Cannot contain control characters"),
  pronouns: z
    .string()
    .trim()
    .max(MAX_PRONOUNS, `Must be ${MAX_PRONOUNS} characters or fewer`)
    .refine((s) => !controlChars.test(s), "Cannot contain control characters")
    .optional(),
  accent_color: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(#[0-9a-f]{6})?$/, "Use a #rrggbb color")
    .optional(),
});
export type ProfileForm = z.infer<typeof profileSchema>;

export function avatarFileProblem(file: { type: string; size: number }): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return "Use a PNG, JPEG, WebP, or GIF image";
  if (file.size > MAX_AVATAR_BYTES) return "Image must be 8 MB or smaller";
  if (file.size === 0) return "Selected file is empty";
  return null;
}
