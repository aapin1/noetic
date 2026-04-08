import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(10),
  NOETIC_BASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().min(1).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NOETIC_BASE_URL: process.env.NOETIC_BASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  });

  return cachedEnv;
}

export const env = new Proxy({} as AppEnv, {
  get(_target, property) {
    return getEnv()[property as keyof AppEnv];
  },
});
