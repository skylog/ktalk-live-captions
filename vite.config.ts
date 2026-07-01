import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(rootDir, "package.json");
const manifestJsonPath = join(rootDir, "manifest.json");
const onboardingHtml = join(rootDir, "src/onboarding/onboarding.html");
const diagnosticsHtml = join(rootDir, "src/diagnostics/diagnostics.html");
const diagnosticsPlaceholderHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Diagnostics | Live Captions</title>
  </head>
  <body>
    <main>
      <h1>Diagnostics</h1>
      <p>This Queue 2 diagnostics entrypoint is wired at build time.</p>
    </main>
  </body>
</html>
`;

function resolvePageInput(target: string, candidates: readonly string[]): [string, string] | undefined {
  for (const candidate of candidates) {
    const fullPath = join(rootDir, candidate);
    if (existsSync(fullPath)) {
      return [target, fullPath];
    }
  }

  return undefined;
}

function buildInputEntries(): Record<string, string> {
  const entries = [
    ["src/background/service-worker", join(rootDir, "src/background/service-worker.ts")],
    ["src/content/content-script", join(rootDir, "src/content/content-script.ts")],
    ["src/popup/popup", join(rootDir, "src/popup/popup.html")],
    ["src/sidebar/sidebar", join(rootDir, "src/sidebar/sidebar.html")],
    ["src/overlay/overlay", join(rootDir, "src/overlay/overlay.html")],
    ["src/onboarding/onboarding", onboardingHtml],
    ["src/settings/settings", join(rootDir, "src/settings/settings.html")],
    resolvePageInput("src/installer/installer", ["src/installer/installer.html", "src/onboarding/onboarding.html"]),
    resolvePageInput("src/diagnostics/diagnostics", ["src/diagnostics/diagnostics.html"]),
  ].filter((entry): entry is [string, string] => entry !== undefined);

  return Object.fromEntries(entries);
}

function copyManifestPlugin(): Plugin {
  return {
    name: "copy-manifest",
    generateBundle() {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
      const manifestJson = JSON.parse(readFileSync(manifestJsonPath, "utf8")) as { version?: string };

      if (packageJson.version !== manifestJson.version) {
        throw new Error(
          `package.json version (${packageJson.version ?? "missing"}) does not match manifest.json version (${manifestJson.version ?? "missing"})`,
        );
      }

      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: readFileSync(manifestJsonPath, "utf8"),
      });
    },
  };
}

function diagnosticsPlaceholderPlugin(): Plugin {
  return {
    name: "diagnostics-placeholder",
    generateBundle() {
      if (existsSync(diagnosticsHtml)) {
        return;
      }

      this.emitFile({
        type: "asset",
        fileName: "src/diagnostics/diagnostics.html",
        source: diagnosticsPlaceholderHtml,
      });
    },
  };
}

export default defineConfig({
  plugins: [copyManifestPlugin(), diagnosticsPlaceholderPlugin()],
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
      input: buildInputEntries(),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
