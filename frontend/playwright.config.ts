import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:8080";

export default defineConfig({
  testMatch: "**/*.spec.ts",
  use: { baseURL },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --strictPort",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
