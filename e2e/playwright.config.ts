import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 4173)

export default defineConfig({
  testDir: './tests',
  // 所有用例共用同一个后端进程和同一份夹具目录，因此串行执行
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 视口必须放在 device 之后，否则会被 Desktop Chrome 的默认尺寸覆盖
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        // 让截图在无头环境下也保持一致
        launchOptions: { args: ['--force-color-profile=srgb', '--font-render-hinting=none'] },
      },
    },
  ],

  webServer: {
    command: 'node scripts/start-app.mjs',
    url: `http://127.0.0.1:${PORT}/api/`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
