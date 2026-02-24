/**
 * Renderer Bundle Loader
 *
 * Imports the isolated renderer bundle from a virtual module that's built
 * inline during the notebook build. This eliminates the need for a separate
 * build step - the isolated renderer is compiled as part of the main build.
 *
 * The virtual module is provided by vite-plugin-isolated-renderer.
 */

import { rendererCode, rendererCss } from "virtual:isolated-renderer";

export { rendererCode, rendererCss };
