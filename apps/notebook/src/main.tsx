import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register built-in widget components
import "@/components/widgets/controls";
import "@/components/widgets/ipycanvas";

// Eagerly preload lazy-loaded output components so they're warm
// by the time the user renders markdown or gets execution output.
import("@/components/outputs/ansi-output");
import("@/components/outputs/markdown-output");
import("@/components/outputs/html-output");
import("@/components/outputs/image-output");
import("@/components/outputs/svg-output");
import("@/components/outputs/json-output");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
