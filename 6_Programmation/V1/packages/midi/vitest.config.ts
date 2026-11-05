import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: {
    alias: {
      "@spp/contracts": fileURLToPath(new URL("../contracts/src/index.ts", import.meta.url)),
    },
  },
});
