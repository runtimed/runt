import { registerWidget } from "../widget-registry";
import { CanvasManagerWidget, CanvasWidget } from "./canvas-widget";

registerWidget("CanvasModel", CanvasWidget);
registerWidget("CanvasManagerModel", CanvasManagerWidget);

export { CanvasManagerWidget, CanvasWidget } from "./canvas-widget";
