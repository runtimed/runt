/**
 * Wrapper around OutputArea that handles Phase 6 manifest resolution.
 *
 * This component accepts raw output strings (which may be JSON or blob hashes)
 * and resolves them to JupyterOutput objects using the manifest resolver.
 */
import { useEffect, useState } from "react";
import { OutputArea } from "@/components/cell/OutputArea";
import { useManifestResolver } from "../hooks/useManifestResolver";
import type { JupyterOutput } from "../types";

interface ResolvedOutputAreaProps {
  /**
   * Raw output strings from the CRDT.
   * Each string may be:
   * - JSON-encoded Jupyter output (Phase 5 format)
   * - 64-char hex blob hash (Phase 6 format)
   */
  outputStrings: string[];
  /**
   * Pre-resolved outputs for immediate display (e.g., from iopub events).
   * These take precedence over outputStrings.
   */
  outputs?: JupyterOutput[];
  /**
   * Whether the output area is collapsed.
   */
  collapsed?: boolean;
  /**
   * Callback when collapse state is toggled.
   */
  onToggleCollapse?: () => void;
  /**
   * Maximum height before scrolling.
   */
  maxHeight?: number;
  /**
   * Additional CSS classes.
   */
  className?: string;
  /**
   * Pre-create the IsolatedFrame even when there are no outputs.
   */
  preloadIframe?: boolean;
  /**
   * Inline renderer code for the iframe.
   */
  rendererCode?: string;
  /**
   * Inline renderer CSS for the iframe.
   */
  rendererCss?: string;
}

/**
 * Check if a string looks like a blob hash (64-char hex).
 */
function looksLikeBlobHash(s: string): boolean {
  return /^[a-f0-9]{64}$/.test(s);
}

export function ResolvedOutputArea({
  outputStrings,
  outputs: preResolvedOutputs,
  collapsed,
  onToggleCollapse,
  maxHeight,
  className,
  preloadIframe,
  rendererCode,
  rendererCss,
}: ResolvedOutputAreaProps) {
  const { resolveOutput, blobPort } = useManifestResolver();
  const [resolvedOutputs, setResolvedOutputs] = useState<JupyterOutput[]>([]);
  const [isResolving, setIsResolving] = useState(false);

  // Resolve output strings to JupyterOutput objects
  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      // If we have pre-resolved outputs, use them directly
      if (preResolvedOutputs && preResolvedOutputs.length > 0) {
        setResolvedOutputs(preResolvedOutputs);
        return;
      }

      // If no output strings, clear resolved outputs
      if (outputStrings.length === 0) {
        setResolvedOutputs([]);
        return;
      }

      // Check if any strings are blob hashes (need resolution)
      const hasHashes = outputStrings.some(looksLikeBlobHash);

      // If no hashes, we can resolve immediately by parsing JSON
      if (!hasHashes) {
        const parsed: JupyterOutput[] = [];
        for (const str of outputStrings) {
          try {
            const output = JSON.parse(str) as JupyterOutput;
            parsed.push(output);
          } catch {
            console.warn(
              "[ResolvedOutputArea] Failed to parse output:",
              str.substring(0, 100),
            );
          }
        }
        setResolvedOutputs(parsed);
        return;
      }

      // We have hashes - need async resolution
      if (blobPort === null) {
        // Blob port not ready yet, wait
        return;
      }

      setIsResolving(true);

      const resolved: JupyterOutput[] = [];
      for (const str of outputStrings) {
        if (cancelled) break;

        const output = await resolveOutput(str);
        if (output) {
          resolved.push(output);
        }
      }

      if (!cancelled) {
        setResolvedOutputs(resolved);
        setIsResolving(false);
      }
    }

    resolve();

    return () => {
      cancelled = true;
    };
  }, [outputStrings, preResolvedOutputs, resolveOutput, blobPort]);

  // Use pre-resolved outputs if available, otherwise use resolved from strings
  const outputs = preResolvedOutputs?.length
    ? preResolvedOutputs
    : resolvedOutputs;

  // Show loading state while resolving blob hashes
  if (
    isResolving &&
    outputs.length === 0 &&
    outputStrings.some(looksLikeBlobHash)
  ) {
    return (
      <div className="px-2 py-1 text-xs text-muted-foreground">Loading...</div>
    );
  }

  return (
    <OutputArea
      outputs={outputs}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      maxHeight={maxHeight}
      className={className}
      preloadIframe={preloadIframe}
      rendererCode={rendererCode}
      rendererCss={rendererCss}
    />
  );
}
