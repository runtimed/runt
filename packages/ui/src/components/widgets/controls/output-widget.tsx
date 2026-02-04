"use client";

/**
 * Output widget - renders captured Jupyter outputs.
 *
 * Maps to ipywidgets OutputModel (@jupyter-widgets/output).
 * Renders an array of Jupyter outputs using the OutputArea component.
 * Media rendering configuration (custom renderers, priority, unsafe)
 * is inherited from MediaProvider context if present.
 */

import { cn } from "@runtimed/ui/lib/utils";
import { type JupyterOutput, OutputArea } from "@runtimed/ui/components/cell/OutputArea";
import type { WidgetComponentProps } from "../widget-registry";
import { useWidgetModelValue } from "../widget-store-context";

export function OutputWidget({ modelId, className }: WidgetComponentProps) {
  const outputs =
    useWidgetModelValue<JupyterOutput[]>(modelId, "outputs") ?? [];

  if (outputs.length === 0) {
    return null;
  }

  return (
    <div
      className={cn("widget-output", className)}
      data-widget-id={modelId}
      data-widget-type="Output"
    >
      <OutputArea outputs={outputs} />
    </div>
  );
}

export default OutputWidget;
