import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les tests d'intégration partagent une base PostgreSQL : un fichier à la fois.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
