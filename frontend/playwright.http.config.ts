import { defineConfig } from "@playwright/test";

// Requires a real local backend on 18000 and Vite in HTTP mode on 5179.
// This suite does not mock fetch or substitute server responses.
export default defineConfig({
  testDir: "./tests-http",
  use: { baseURL: "http://127.0.0.1:5179", trace: "retain-on-failure" },
  projects: [
    { name: "http-desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "http-mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
