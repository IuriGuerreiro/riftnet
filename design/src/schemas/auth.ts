import { z } from "zod";

const email = z.email("Enter a valid email address").trim();
const password = z.string().min(8, "Must be at least 8 characters").max(128);

export const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password") });
export type LoginForm = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    email,
    password,
    confirm: z.string(),
    terms: z.boolean().refine(Boolean, "Please accept the terms to continue"),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords don't match",
  });
export type RegisterForm = z.infer<typeof registerSchema>;

export const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;
export const usernameSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_RE, "Use 3 to 32 letters, numbers, underscores, or dots"),
});
export type UsernameForm = z.infer<typeof usernameSchema>;
