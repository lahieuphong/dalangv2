import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build can be hosted from any sub-path.
  base: './',
  plugins: [react()],
  // The hand-tracking worker is an ES module (it imports MediaPipe).
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
