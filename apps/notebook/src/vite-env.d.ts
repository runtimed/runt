/// <reference types="vite/client" />

// Vite raw import type declaration
declare module "*?raw" {
  const content: string;
  export default content;
}

// Inline bundle alias type declarations
declare module "@isolated-bundle/isolated-renderer.js?raw" {
  const content: string;
  export default content;
}

declare module "@isolated-bundle/isolated-renderer.css?raw" {
  const content: string;
  export default content;
}
