import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CellContainerProps {
  id: string;
  isFocused?: boolean;
  onFocus?: () => void;
  children: ReactNode;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  className?: string;
  focusBgColor?: string;
  focusBorderColor?: string;
}

export const CellContainer = forwardRef<HTMLDivElement, CellContainerProps>(
  (
    {
      id,
      isFocused = false,
      onFocus,
      children,
      onDragStart,
      onDragOver,
      onDrop,
      className,
      focusBgColor = "",
      focusBorderColor = "border-l-primary",
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        data-slot="cell-container"
        data-cell-id={id}
        className={cn(
          "cell-container group relative border-l-2 transition-all duration-200",
          isFocused
            ? [focusBgColor, focusBorderColor]
            : "border-l-transparent",
          className,
        )}
        onMouseDown={onFocus}
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {children}
      </div>
    );
  },
);

CellContainer.displayName = "CellContainer";
