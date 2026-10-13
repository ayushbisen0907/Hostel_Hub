import os from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    // keep test uploads out of the real uploads/ folder
    env: { UPLOAD_DIR: path.join(os.tmpdir(), 'hostelhub-test-uploads') },
  },
})
