/**
 * Playwright configuration for HDSP Agent UI tests
 *
 * Galata-based E2E testing with network mocking for token-free testing
 */

import { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  testDir: './ui-tests',
  timeout: 60000,
  retries: 1,
  workers: 1, // JupyterLab requires sequential execution

  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: 'http://localhost:8888',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // JupyterLab server configuration
  webServer: {
    command: 'jupyter lab --no-browser --port=8888 --NotebookApp.token=""',
    port: 8888,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  // Reporter configuration
  reporter: [['html', { open: 'never' }], ['list']],
};

export default config;
