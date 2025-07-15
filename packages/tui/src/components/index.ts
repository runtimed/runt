// Layout components
export { Header } from "./layout/Header.tsx";
export { Footer } from "./layout/Footer.tsx";
export { LoadingIndicator } from "./layout/LoadingIndicator.tsx";
export { ErrorDisplay } from "./layout/ErrorDisplay.tsx";
export { ScrollableContainer } from "./layout/ScrollableContainer.tsx";
export { HeightConstrainedBox } from "./layout/HeightConstrainedBox.tsx";

// Notebook components
export { Cell } from "./notebook/Cell.tsx";
export { NotebookRenderer } from "./notebook/NotebookRenderer.tsx";

// Output components
export { TerminalOutput } from "./outputs/TerminalOutput.tsx";
export { MultimediaOutput } from "./outputs/MultimediaOutput.tsx";
export { OutputRenderer } from "./outputs/OutputRenderer.tsx";
export { MarkdownRenderer } from "./outputs/MarkdownRenderer.tsx";

// Utilities
export { useExitHandler } from "../utils/useExitHandler.ts";
export { Colors } from "../utils/colors.ts";
export {
  getUnsupportedContentMessage,
  isTerminalFriendly,
  processMultimediaOutput,
  selectTerminalRepresentation,
  shouldRenderAsJson,
} from "../utils/representationSelector.ts";
