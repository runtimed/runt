/**
 * Vite Plugin: Isolated Renderer
 *
 * Builds the isolated renderer bundle during the notebook build and exposes
 * it as a virtual module. This eliminates the need for a separate build step.
 *
 * Usage:
 *   import { rendererCode, rendererCss } from 'virtual:isolated-renderer';
 */

import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build, type Plugin } from "vite";

const VIRTUAL_MODULE_ID = "virtual:isolated-renderer";
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

interface IsolatedRendererPluginOptions {
  /**
   * Path to the isolated renderer entry file.
   * @default "../../src/isolated-renderer/index.tsx"
   */
  entry?: string;
  /**
   * Enable minification for production builds.
   * @default false
   */
  minify?: boolean;
}

export function isolatedRendererPlugin(
  options: IsolatedRendererPluginOptions = {},
): Plugin {
  const {
    entry = path.resolve(__dirname, "../../src/isolated-renderer/index.tsx"),
    minify = false,
  } = options;

  let rendererCode = "";
  let rendererCss = "";
  let buildPromise: Promise<void> | null = null;

  async function buildRenderer() {
    const srcDir = path.resolve(__dirname, "../../src");

    const result = await build({
      configFile: false,
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          "@/": `${srcDir}/`,
        },
      },
      build: {
        write: false, // Don't write to disk, return in memory
        lib: {
          entry,
          name: "IsolatedRenderer",
          formats: ["iife"],
          fileName: () => "isolated-renderer.js",
        },
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
            assetFileNames: "isolated-renderer.[ext]",
          },
          external: [
            "@tauri-apps/api",
            "@tauri-apps/plugin-shell",
            "@tauri-apps/plugin-fs",
            /^@tauri-apps\/.*/,
          ],
        },
        minify,
        sourcemap: false, // No source maps for embedded bundle
      },
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      logLevel: "warn", // Reduce noise during build
    });

    // Extract JS and CSS from build output
    const outputs = Array.isArray(result) ? result : [result];
    for (const output of outputs) {
      if ("output" in output) {
        for (const chunk of output.output) {
          if (chunk.type === "chunk" && chunk.fileName.endsWith(".js")) {
            rendererCode = chunk.code;
          } else if (
            chunk.type === "asset" &&
            chunk.fileName.endsWith(".css")
          ) {
            rendererCss =
              typeof chunk.source === "string"
                ? chunk.source
                : new TextDecoder().decode(chunk.source);
          }
        }
      }
    }

    if (!rendererCode) {
      throw new Error(
        "Failed to build isolated renderer: no JS output produced",
      );
    }
  }

  return {
    name: "isolated-renderer",

    async buildStart() {
      // Build the isolated renderer at the start of the main build
      // Cache the promise so we only build once even if called multiple times
      if (!buildPromise) {
        buildPromise = buildRenderer();
      }
      await buildPromise;
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        // Export the built code as strings
        return `
export const rendererCode = ${JSON.stringify(rendererCode)};
export const rendererCss = ${JSON.stringify(rendererCss)};
`;
      }
    },

    // For dev server: serve the virtual module
    configureServer(server) {
      // Ensure renderer is built before serving
      server.middlewares.use(async (_req, _res, next) => {
        if (!buildPromise) {
          buildPromise = buildRenderer();
        }
        await buildPromise;
        next();
      });
    },
  };
}

export default isolatedRendererPlugin;
