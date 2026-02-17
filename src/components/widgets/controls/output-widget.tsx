"use client";

/**
 * Output widget - renders captured Jupyter outputs.
 *
 * Maps to ipywidgets OutputModel (@jupyter-widgets/output).
 * Renders an array of Jupyter outputs using the OutputArea component.
 * Media rendering configuration (custom renderers, priority, unsafe)
 * is inherited from MediaProvider context if present.
 */

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { type JupyterOutput, OutputArea } from "@/components/cell/OutputArea";
import type { WidgetComponentProps } from "../widget-registry";
import {
  useWidgetModelValue,
  useWidgetStoreRequired,
} from "../widget-store-context";

interface OutputCustomMessage {
  method?: unknown;
  output?: unknown;
  wait?: unknown;
}

function isJupyterOutput(value: unknown): value is JupyterOutput {
  if (!value || typeof value !== "object") return false;
  const output = value as Partial<JupyterOutput>;
  return (
    output.output_type === "execute_result" ||
    output.output_type === "display_data" ||
    output.output_type === "stream" ||
    output.output_type === "error"
  );
}

export function OutputWidget({ modelId, className }: WidgetComponentProps) {
  const { store } = useWidgetStoreRequired();
  const stateOutputs =
    useWidgetModelValue<JupyterOutput[]>(modelId, "outputs") ?? [];
  const stateOutputsRef = useRef(stateOutputs);
  const shouldClearOnNextOutputRef = useRef(false);
  const [renderedOutputs, setRenderedOutputs] = useState<JupyterOutput[]>(
    stateOutputs
  );

  useEffect(() => {
    stateOutputsRef.current = stateOutputs;
    setRenderedOutputs(stateOutputs);
  }, [stateOutputs]);

  useEffect(() => {
    let replayingBufferedMessages = true;

    const unsubscribe = store.subscribeToCustomMessage(modelId, (content) => {
      const message = content as OutputCustomMessage;
      const method =
        typeof message.method === "string" ? message.method : undefined;

      // OutputModel may have already synchronized state.outputs.
      // Skip initial buffered custom messages in that case to avoid duplicates.
      if (replayingBufferedMessages && stateOutputsRef.current.length > 0) {
        return;
      }

      if (method === "clear_output") {
        const wait = Boolean(message.wait);
        if (wait) {
          shouldClearOnNextOutputRef.current = true;
        } else {
          shouldClearOnNextOutputRef.current = false;
          setRenderedOutputs([]);
        }
        return;
      }

      if (method !== "output" || !isJupyterOutput(message.output)) {
        return;
      }
      const nextOutput: JupyterOutput = message.output;

      setRenderedOutputs((prev) => {
        if (shouldClearOnNextOutputRef.current) {
          shouldClearOnNextOutputRef.current = false;
          return [nextOutput];
        }
        return [...prev, nextOutput];
      });
    });

    replayingBufferedMessages = false;
    return unsubscribe;
  }, [modelId, store]);

  if (renderedOutputs.length === 0) {
    return null;
  }

  return (
    <div
      className={cn("widget-output", className)}
      data-widget-id={modelId}
      data-widget-type="Output"
    >
      <OutputArea outputs={renderedOutputs} isolated={false} />
    </div>
  );
}

export default OutputWidget;
