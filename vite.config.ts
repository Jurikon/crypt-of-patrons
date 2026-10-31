import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works both at the GitHub Pages subpath and locally.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
