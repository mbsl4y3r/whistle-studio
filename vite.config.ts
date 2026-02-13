import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/whistle-studio/" : "/",
  worker: {
    format: "es"
  }
}));
