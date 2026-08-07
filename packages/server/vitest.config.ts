import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      VISION_PROVIDER: "stub",
      UPLOAD_DIR: "./.test-uploads",
    },
  },
});
