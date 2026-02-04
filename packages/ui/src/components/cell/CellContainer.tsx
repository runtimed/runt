import { forwardRef, type ReactNode } from "react";
import { cn } from "@runtimed/ui/lib/utils";

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
      focusBgColor = "bg-primary/5",
      focusBorderColor = "border-primary/60",
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        data-slot="cell-container"
        data-cell-id={id}
        className={cn(
          "cell-container group relative border-2 transition-all duration-200",
          isFocused
            ? [focusBgColor, focusBorderColor]
            : "border-transparent hover:bg-muted/10",
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
