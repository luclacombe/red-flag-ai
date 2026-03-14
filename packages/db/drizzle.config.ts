import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: drizzle-kit CLI fails clearly if missing
    url: process.env.DATABASE_URL!,
  },
});
