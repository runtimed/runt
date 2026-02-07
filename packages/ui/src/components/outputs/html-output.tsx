"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface HtmlOutputProps {
  /**
   * The HTML content to render
   */
  content: string;
  /**
   * Allow rendering potentially unsafe HTML with script execution.
   * When true, throws an error if not running inside an iframe.
   * When false (default), renders HTML without script execution.
   */
  unsafe?: boolean;
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
 * HtmlOutput component for rendering HTML content in notebook outputs
 *
 * This component handles HTML output from Jupyter kernels, such as
 * pandas DataFrames, rich HTML displays, and basic interactives.
 *
 * Security considerations:
 * - By default, renders HTML statically without script execution
 * - Set `unsafe={true}` to enable script execution (requires iframe sandbox)
 * - When `unsafe={true}`, throws if not inside an iframe for security
 */
export function HtmlOutput({
  content,
  unsafe = false,
  className = "",
}: HtmlOutputProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !content) return;

    if (unsafe) {
      // For unsafe mode, require iframe sandboxing
      if (!isInIframe()) {
        throw new Error(
          "HtmlOutput with unsafe={true} must be rendered inside an iframe for security. " +
            "Use unsafe={false} for static HTML rendering without script execution.",
        );
      }

      // Use createContextualFragment for proper script execution
      // This allows scripts in the HTML to run, which is necessary for
      // interactive outputs like Plotly, Bokeh, etc.
      const range = document.createRange();
      const fragment = range.createContextualFragment(content);
      ref.current.innerHTML = "";
      ref.current.appendChild(fragment);
    } else {
      // Safe mode: just set innerHTML (scripts won't execute)
      ref.current.innerHTML = content;
    }
  }, [content, unsafe]);

  if (!content) {
    return null;
  }

  return (
    <div
      ref={ref}
      data-slot="html-output"
      className={cn("not-prose py-2 max-w-none overflow-auto", className)}
      // For SSR/initial render, use dangerouslySetInnerHTML
      // The useEffect will take over on the client
      dangerouslySetInnerHTML={unsafe ? undefined : { __html: content }}
    />
  );
}
