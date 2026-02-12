import { Loader2, Play, Square } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

interface PlayButtonProps {
  executionState: "idle" | "queued" | "running" | "completed" | "error";
  cellType: string;
  isFocused?: boolean;
  onExecute: () => void;
  onInterrupt: () => void;
  className?: string;
  focusedClass?: string;
  isAutoLaunching?: boolean;
}

export const PlayButton: React.FC<PlayButtonProps> = ({
  executionState,
  cellType,
  isFocused = false,
  onExecute,
  onInterrupt,
  className = "",
  focusedClass = "text-foreground",
  isAutoLaunching = false,
}) => {
  const isRunning = executionState === "running" || executionState === "queued";
  const title = isAutoLaunching
    ? "Starting runtime..."
    : isRunning
      ? "Stop execution"
      : `Execute ${cellType} cell`;

  return (
    <button
      data-slot="play-button"
      onClick={isRunning ? onInterrupt : onExecute}
      disabled={isAutoLaunching}
      className={cn(
        "hover:bg-muted/80 flex items-center justify-center rounded-sm bg-background p-1 transition-colors",
        isRunning
          ? "text-destructive hover:text-destructive shadow-destructive/20 animate-pulse drop-shadow-sm"
          : isFocused
            ? focusedClass
            : "text-muted-foreground/40 hover:text-foreground group-hover:text-foreground",
        isAutoLaunching && "cursor-wait opacity-75",
        className,
      )}
      title={title}
    >
      {isAutoLaunching ? (
        <Loader2 className="size-4 animate-spin" />
      ) : isRunning ? (
        <Square
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="size-4"
        />
      ) : (
        <Play fill="currentColor" className="size-4" />
      )}
    </button>
  );
};
