import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register built-in widget components
import "@runtimed/ui/components/widgets/controls";
import "@runtimed/ui/components/widgets/ipycanvas";

// Eagerly preload lazy-loaded output components so they're warm
// by the time the user renders markdown or gets execution output.
import("@runtimed/ui/components/outputs/ansi-output");
import("@runtimed/ui/components/outputs/markdown-output");
import("@runtimed/ui/components/outputs/html-output");
import("@runtimed/ui/components/outputs/image-output");
import("@runtimed/ui/components/outputs/svg-output");
import("@runtimed/ui/components/outputs/json-output");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
