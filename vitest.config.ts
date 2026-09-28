import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['artifacts/docknee/src/lib/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'artifacts/docknee/src/lib/cunha.ts',
        'artifacts/docknee/src/lib/level-decision.ts',
        'artifacts/docknee/src/lib/dfo-geometry.ts',
      ],
      thresholds: {
        functions: 100,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'artifacts/docknee/src'),
    },
  },
});
