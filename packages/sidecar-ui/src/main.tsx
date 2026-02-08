import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

type SidecarGlobal = typeof globalThis & {
  onMessage?: (msg: unknown) => void;
  __sidecarPendingMessages?: unknown[];
  onSidecarInfo?: (msg: unknown) => void;
  __sidecarPendingInfoMessages?: unknown[];
};

const sidecarGlobal = globalThis as SidecarGlobal;

if (!sidecarGlobal.__sidecarPendingMessages) {
  sidecarGlobal.__sidecarPendingMessages = [];
}
if (!sidecarGlobal.__sidecarPendingInfoMessages) {
  sidecarGlobal.__sidecarPendingInfoMessages = [];
}

if (typeof sidecarGlobal.onMessage !== "function") {
  sidecarGlobal.onMessage = (msg: unknown) => {
    sidecarGlobal.__sidecarPendingMessages?.push(msg);
  };
}
if (typeof sidecarGlobal.onSidecarInfo !== "function") {
  sidecarGlobal.onSidecarInfo = (msg: unknown) => {
    sidecarGlobal.__sidecarPendingInfoMessages?.push(msg);
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
