import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'docknee',
          include: ['artifacts/docknee/src/lib/**/*.test.ts'],
          environment: 'node',
          // DocKnee users are in Brazil (UTC-3): run the web tests there so
          // calendar dates that would shift a day west of UTC are caught.
          env: { TZ: 'America/Sao_Paulo' },
        },
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'artifacts/docknee/src'),
          },
        },
      },
      {
        test: {
          name: 'docregen',
          include: ['artifacts/docregen/src/**/*.test.ts'],
          environment: 'node',
          // DocRegen users are in Brazil (UTC-3): run the web tests there so
          // calendar dates that would shift a day west of UTC are caught.
          env: { TZ: 'America/Sao_Paulo' },
        },
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'artifacts/docregen/src'),
          },
        },
      },
    ],
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
});
