import { defineConfig } from "@playwright/test";
export default defineConfig({
  outputDir: "./test-results/screening",
  testDir: "./tests-screening",
  timeout: 450000,
  expect: { timeout: 15000 },
  workers: 2,
  use: { baseURL: "http://127.0.0.1:5180", trace: "retain-on-failure" },
  projects: [
    {
      name: "screening-desktop",
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "screening-mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
