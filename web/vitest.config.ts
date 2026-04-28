import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../src/shared"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "src/test/setup.ts")],
    css: true,
    include: [path.resolve(__dirname, "src/**/*.{test,spec}.{ts,tsx}")],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
