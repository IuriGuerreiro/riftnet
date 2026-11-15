import { z } from "zod";

// Same rules as the api, checked before sending.
export const credentialsSchema = z.object({
  email: z.email("That doesn't look like an email").trim(),
  password: z.string().min(8, "At least 8 characters").max(128),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const usernameSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,32}$/, "3–32 characters: letters, numbers, _ and ."),
});
export type UsernameForm = z.infer<typeof usernameSchema>;
