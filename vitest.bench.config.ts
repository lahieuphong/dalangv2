import { defineConfig } from 'vitest/config'

// `yarn bench:rally`: the deterministic rally benchmark, kept apart from the test suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/**/*.bench.ts'],
    testTimeout: 300_000,
  },
})
