"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface SvgOutputProps {
  /**
   * The SVG content as a string
   */
  data: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * SvgOutput component for rendering SVG graphics in notebook outputs
 *
 * This component handles SVG output from Jupyter kernels, commonly used
 * for matplotlib figures rendered as SVG, diagrams, and other vector graphics.
 *
 * The SVG is inserted directly into the DOM to preserve interactivity
 * and allow proper scaling.
 */
export function SvgOutput({ data, className = "" }: SvgOutputProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !data) return;

    // Clear existing content and insert the SVG
    ref.current.innerHTML = "";
    ref.current.insertAdjacentHTML("beforeend", data);

    // Find the SVG element and ensure it scales properly
    const svg = ref.current.querySelector("svg");
    if (svg) {
      // Ensure SVG scales responsively if no explicit dimensions
      if (!svg.hasAttribute("width") && !svg.hasAttribute("height")) {
        svg.style.maxWidth = "100%";
        svg.style.height = "auto";
      }
    }
  }, [data]);

  if (!data) {
    return null;
  }

  return (
    <div
      ref={ref}
      data-slot="svg-output"
      className={cn("not-prose py-2 max-w-full overflow-auto", className)}
    />
  );
}
