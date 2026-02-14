import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Vite configuration for building the isolated-renderer bundle.
 *
 * This creates a single IIFE bundle that can be:
 * 1. Imported as a string
 * 2. Sent to an isolated iframe via postMessage eval
 * 3. Self-executes to initialize the React renderer
 *
 * The bundle includes React and all dependencies inline.
 * It explicitly excludes Tauri dependencies (which shouldn't be imported anyway).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "..") + "/",
    },
  },
  build: {
    // Output as a library in IIFE format (self-executing)
    lib: {
      entry: path.resolve(__dirname, "index.tsx"),
      name: "IsolatedRenderer",
      formats: ["iife"],
      fileName: () => "isolated-renderer.js",
    },
    outDir: path.resolve(__dirname, "../../apps/notebook/public/isolated"),
    emptyOutDir: true,
    // Inline all dependencies (don't externalize anything)
    rollupOptions: {
      output: {
        // Ensure everything is in one file
        inlineDynamicImports: true,
        // Control asset naming (for CSS)
        assetFileNames: "isolated-renderer.[ext]",
      },
      // Mark Tauri packages as external to prevent accidental inclusion
      // (they shouldn't be imported, but this ensures build fails if they are)
      external: [
        "@tauri-apps/api",
        "@tauri-apps/plugin-shell",
        "@tauri-apps/plugin-fs",
        /^@tauri-apps\/.*/,
      ],
    },
    // Don't minify for easier debugging (can enable in production)
    minify: false,
    // Generate source maps for debugging
    sourcemap: true,
  },
  // Define to help with React production build
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
