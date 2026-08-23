import { defineConfig } from "vitest/config";
import path from "path";

// Config separada do vite.config.ts (que é restrita ao Tauri).
// Testa apenas lógica pura em ambiente Node, sem DOM.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/__tests__/**", "src/**/*.d.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        // Baseline for the currently covered pure-library surface. Increase
        // these values as the remaining library modules gain tests.
        statements: 50,
        branches: 40,
        functions: 40,
        lines: 50,
      },
    },
  },
});
