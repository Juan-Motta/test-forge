import { z } from "zod";

// Limits mirror the backend's LoginRequest so the form never sends what the API would reject.
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(320, "Use at most 320 characters.")
    .regex(/^[^\s@]+@[^\s@]+$/, "Enter a valid email address."),
  password: z.string().min(1, "Enter your password.").max(1024, "Use at most 1024 characters."),
});

export type LoginValues = z.infer<typeof loginSchema>;
