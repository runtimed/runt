/// <reference types="vite/client" />

// KaTeX CSS type declaration for side-effect imports
declare module "katex/dist/katex.min.css";

// Vite raw import type declaration
declare module "*?raw" {
  const content: string;
  export default content;
}
