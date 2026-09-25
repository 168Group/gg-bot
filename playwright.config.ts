import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://localhost:3100', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  webServer: [
    { command: 'pnpm demo', url: 'http://localhost:3100/health/live', timeout: 60000, reuseExistingServer: false, env: { DEMO_PORT: '3100', DEMO_DB_PORT: '8092', DEMO_DB_DIR: '.local/e2e-pocketbase' } },
    { command: 'pnpm dev:setup', url: 'http://localhost:3200/health/live', timeout: 60000, reuseExistingServer: false, env: { SETUP_PORT: '3200', SETUP_DATA_DIR: '.local/e2e-installation' } }
  ],
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }]
});
