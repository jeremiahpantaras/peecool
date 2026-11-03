import { defineConfig } from '@playwright/test';

const PORT = 18181;
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: '/tmp/pickle-e2e-results',
  webServer: {
    command: 'rm -rf /tmp/pickle-e2e && PICKLE_DATA_DIR=/tmp/pickle-e2e PICKLE_PORT=18181 PICKLE_HOST=127.0.0.1 PICKLE_LOG_LEVEL=warn npx tsx apps/server/src/main.ts',
    cwd: '..', url: `http://localhost:${PORT}/api/v1/health`, reuseExistingServer: false, timeout: 60_000,
  },
});
