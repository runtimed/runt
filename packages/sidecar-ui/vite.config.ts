import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const sidecarSrc = path.resolve(__dirname, "./src");
const uiSrc = path.resolve(__dirname, "../ui/src");

// Resolve @/ imports based on the importer's location:
// - Files from @runtimed/ui → resolve to packages/ui/src/
// - Files from sidecar-ui → resolve to packages/sidecar-ui/src/
function resolveAtAlias(): Plugin {
  return {
    name: "resolve-at-alias",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.startsWith("@/") || !importer) return null;
      const root = importer.startsWith(uiSrc + "/") ? uiSrc : sidecarSrc;
      return this.resolve(
        source.replace("@/", root + "/"),
        importer,
        { ...options, skipSelf: true },
      );
    },
  };
}

export default defineConfig({
  plugins: [resolveAtAlias(), react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Single bundle for embedding in Rust
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  // Base path for custom protocol
  base: "/",
});
