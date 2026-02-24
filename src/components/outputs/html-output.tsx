"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface HtmlOutputProps {
  /**
   * The HTML content to render
   */
  content: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * Check if the current window is inside an iframe
 */
function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // If we can't access window.top due to cross-origin restrictions,
    // we're definitely in an iframe
    return true;
  }
}

/**
 * HtmlOutput component for rendering HTML content in notebook outputs.
 *
 * This component handles HTML output from Jupyter kernels, such as
 * pandas DataFrames, rich HTML displays, and interactive visualizations.
 *
 * SECURITY: This component MUST be rendered inside a sandboxed iframe.
 * Use OutputArea (with isolated="auto") or IsolatedFrame directly.
 * Throws an error if rendered in the main DOM.
 */
export function HtmlOutput({ content, className = "" }: HtmlOutputProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Require iframe for security - HTML can contain CSS attacks, forms, etc.
  if (typeof window !== "undefined" && !isInIframe()) {
    throw new Error(
      "HtmlOutput must be rendered inside an iframe. " +
        "Use OutputArea or IsolatedFrame for HTML content.",
    );
  }

  useEffect(() => {
    if (!ref.current || !content) return;

    // Use createContextualFragment for proper script execution
    // This allows scripts in the HTML to run, which is necessary for
    // interactive outputs like Plotly, Bokeh, etc.
    const range = document.createRange();
    const fragment = range.createContextualFragment(content);
    ref.current.innerHTML = "";
    ref.current.appendChild(fragment);
  }, [content]);

  if (!content) {
    return null;
  }

  return (
    <div
      ref={ref}
      data-slot="html-output"
      className={cn("not-prose py-2 max-w-none overflow-auto", className)}
    />
  );
}
