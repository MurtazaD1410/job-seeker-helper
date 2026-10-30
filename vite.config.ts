import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { manifest } from "./src/manifest";

// Emits the typed manifest as dist/manifest.json.
function manifestPlugin(): Plugin {
  return {
    name: "emit-manifest",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: JSON.stringify(manifest, null, 2) });
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), manifestPlugin()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, "sidepanel.html"),
        background: path.resolve(__dirname, "src/background/index.ts")
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js")
      }
    }
  }
});
