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
        "flex items-center justify-center transition-all",
        isRunning
          ? "text-destructive hover:text-destructive animate-pulse"
          : isFocused
            ? focusedClass
            : "text-transparent group-hover:text-muted-foreground hover:text-foreground",
        isAutoLaunching && "cursor-wait opacity-75",
        className,
      )}
      title={title}
    >
      {isAutoLaunching ? (
        <Loader2 className="size-3 animate-spin" />
      ) : isRunning ? (
        <Square
          fill="currentColor"
          stroke="none"
          className="size-2.5"
        />
      ) : (
        <Play fill="currentColor" stroke="none" className="size-3 translate-x-[1px]" />
      )}
    </button>
  );
};
