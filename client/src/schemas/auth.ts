import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.email("Enter a valid email address").trim(),
  password: z.string().min(8, "Must be at least 8 characters").max(128),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const usernameSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,32}$/, "Use 3 to 32 letters, numbers, underscores, or dots"),
});
export type UsernameForm = z.infer<typeof usernameSchema>;
