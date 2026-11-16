import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'core/**/*.test.ts', 'server/**/*.test.ts', 'contracts/**/*.test.ts', 'mcp/**/*.test.ts'],
    environment: 'node',
    reporters: process.env.CI ? ['dot'] : ['default'],
  },
});
