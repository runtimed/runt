import { useCallback, useEffect, useState } from "react";
import { Save, Play, Square, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KernelspecInfo } from "../types";

interface NotebookToolbarProps {
  kernelStatus: string;
  dirty: boolean;
  onSave: () => void;
  onStartKernel: (name: string) => void;
  onInterruptKernel: () => void;
  onAddCell: (type: "code" | "markdown") => void;
  listKernelspecs: () => Promise<KernelspecInfo[]>;
}

export function NotebookToolbar({
  kernelStatus,
  dirty,
  onSave,
  onStartKernel,
  onInterruptKernel,
  onAddCell,
  listKernelspecs,
}: NotebookToolbarProps) {
  const [kernelspecs, setKernelspecs] = useState<KernelspecInfo[]>([]);

  useEffect(() => {
    listKernelspecs().then(setKernelspecs);
  }, [listKernelspecs]);

  const handleStartKernel = useCallback(() => {
    // Default to python3 or first available
    const python = kernelspecs.find(
      (k) => k.name === "python3" || k.name === "python"
    );
    const spec = python ?? kernelspecs[0];
    if (spec) {
      onStartKernel(spec.name);
    }
  }, [kernelspecs, onStartKernel]);

  const isKernelRunning =
    kernelStatus === "idle" ||
    kernelStatus === "busy" ||
    kernelStatus === "starting";

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="flex h-10 items-center gap-2 px-3">
        {/* Save */}
        <button
          type="button"
          onClick={onSave}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-muted",
            dirty
              ? "text-foreground"
              : "text-muted-foreground"
          )}
          title="Save (Cmd+S)"
        >
          <Save className="h-3.5 w-3.5" />
          {dirty && <span className="text-[10px]">&bull;</span>}
        </button>

        <div className="h-4 w-px bg-border" />

        {/* Add cells */}
        <button
          type="button"
          onClick={() => onAddCell("code")}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Add code cell"
        >
          <Plus className="h-3 w-3" />
          Code
        </button>
        <button
          type="button"
          onClick={() => onAddCell("markdown")}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Add markdown cell"
        >
          <Plus className="h-3 w-3" />
          Markdown
        </button>

        <div className="flex-1" />

        {/* Kernel controls */}
        {!isKernelRunning ? (
          <button
            type="button"
            onClick={handleStartKernel}
            disabled={kernelspecs.length === 0}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            title="Start kernel"
          >
            <Play className="h-3 w-3" fill="currentColor" />
            Start Kernel
          </button>
        ) : (
          <button
            type="button"
            onClick={onInterruptKernel}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Interrupt kernel"
          >
            <Square className="h-3 w-3" />
            Interrupt
          </button>
        )}

        {/* Kernel status */}
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              kernelStatus === "idle" && "bg-green-500",
              kernelStatus === "busy" && "bg-amber-500",
              kernelStatus === "starting" && "bg-blue-500 animate-pulse",
              kernelStatus === "not started" && "bg-gray-400",
              kernelStatus === "error" && "bg-red-500"
            )}
          />
          <span className="text-xs text-muted-foreground capitalize">
            {kernelStatus}
          </span>
        </div>
      </div>
    </header>
  );
}
