import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

const edge = process.platform === 'win32' && fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
export default defineConfig({
  testDir: 'tests/e2e', testMatch: '*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 90000, expect: { timeout: 20000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3211', browserName: 'chromium', channel: edge ? 'msedge' : undefined, viewport: { width: 1440, height: 960 }, launchOptions: { chromiumSandbox: true }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npx tsx tests/e2e/server.ts', url: 'http://127.0.0.1:3211/api/bootstrap', timeout: 120000, reuseExistingServer: false },
});
