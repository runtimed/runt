import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register built-in widget components
import "@/components/widgets/controls";
import "@/components/widgets/ipycanvas";

// Preload output components used in main bundle (via MediaRouter).
// Note: markdown-output, html-output, svg-output are isolated-only
// and bundled separately in src/isolated-renderer/ - no need to preload here.
import("@/components/outputs/ansi-output");
import("@/components/outputs/image-output");
import("@/components/outputs/json-output");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
