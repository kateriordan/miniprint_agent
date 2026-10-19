import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "#shared": path("./shared"),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        // Needs DATABASE_URL pointing at a migrated, disposable database.
        extends: true,
        resolve: { alias: { "@nuxthub/db": path("./tests/support/nuxthub-db.ts") } },
        test: { name: "integration", include: ["tests/integration/**/*.test.ts"], setupFiles: ["tests/support/globals.ts"], fileParallelism: false },
      },
    ],
  },
});
