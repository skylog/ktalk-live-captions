import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

function copyManifestPlugin(): Plugin {
  return {
    name: "copy-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: readFileSync(join(rootDir, "manifest.json"), "utf8"),
      });
    },
  };
}

export default defineConfig({
  plugins: [copyManifestPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "src/background/service-worker": join(rootDir, "src/background/service-worker.ts"),
        "src/content/content-script": join(rootDir, "src/content/content-script.ts"),
        "src/popup/popup": join(rootDir, "src/popup/popup.html"),
        "src/sidebar/sidebar": join(rootDir, "src/sidebar/sidebar.html"),
        "src/overlay/overlay": join(rootDir, "src/overlay/overlay.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
