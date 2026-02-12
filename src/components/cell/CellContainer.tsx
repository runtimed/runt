import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CellContainerProps {
  id: string;
  cellType?: "code" | "markdown";
  isFocused?: boolean;
  onFocus?: () => void;
  children: ReactNode;
  /** Content to render in the gutter (e.g., play button) */
  gutterContent?: ReactNode;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  className?: string;
}

const getGutterColor = (cellType?: "code" | "markdown", isFocused?: boolean) => {
  switch (cellType) {
    case "markdown":
      return isFocused ? "bg-amber-400" : "bg-amber-200";
    case "code":
    default:
      return isFocused ? "bg-gray-400" : "bg-gray-200";
  }
};

const getFocusBgColor = (cellType?: "code" | "markdown") => {
  switch (cellType) {
    case "markdown":
      return "bg-amber-50/50";
    case "code":
    default:
      return "bg-gray-50/50";
  }
};

export const CellContainer = forwardRef<HTMLDivElement, CellContainerProps>(
  (
    {
      id,
      cellType,
      isFocused = false,
      onFocus,
      children,
      gutterContent,
      onDragStart,
      onDragOver,
      onDrop,
      className,
    },
    ref,
  ) => {
    const gutterColor = getGutterColor(cellType, isFocused);
    const focusBgColor = getFocusBgColor(cellType);

    return (
      <div
        ref={ref}
        data-slot="cell-container"
        data-cell-id={id}
        className={cn(
          "cell-container group flex transition-colors duration-150",
          isFocused && focusBgColor,
          className,
        )}
        onMouseDown={onFocus}
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* Gutter area: action button + thin ribbon */}
        <div className="flex-shrink-0 flex">
          {/* Action button area (play button for code cells) */}
          <div className="w-6 flex items-start justify-center pt-1.5">
            {gutterContent}
          </div>
          {/* Thin ribbon */}
          <div
            className={cn(
              "w-1 transition-colors duration-150",
              gutterColor,
            )}
          />
        </div>
        {/* Cell content */}
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    );
  },
);

CellContainer.displayName = "CellContainer";
