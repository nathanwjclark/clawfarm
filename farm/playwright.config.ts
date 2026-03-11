import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*.spec.ts",
  timeout: 600_000,
  use: {
    baseURL: "http://localhost:3847",
    headless: true,
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
