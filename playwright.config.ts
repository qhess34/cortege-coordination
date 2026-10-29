import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:3100', locale: 'fr-FR', viewport: { width: 1400, height: 900 } },
  webServer: { command: 'sh e2e/start-server.sh', url: 'http://127.0.0.1:3100/api/health', reuseExistingServer: false, timeout: 60_000 },
});
