import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    alias: {
      // Match tsconfig baseUrl: "src"
      '~': path.resolve(__dirname, 'src'),
    },
  },
});
