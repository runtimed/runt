import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CellContainerProps {
  id: string;
  cellType?: "code" | "markdown";
  isFocused?: boolean;
  onFocus?: () => void;
  children: ReactNode;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  className?: string;
}

const getCellStyling = (cellType?: "code" | "markdown") => {
  switch (cellType) {
    case "markdown":
      return {
        focusBgColor: "bg-amber-50",
        focusBorderColor: "border-l-amber-400",
        hoverBorderColor: "hover:border-l-amber-300",
      };
    case "code":
    default:
      return {
        focusBgColor: "bg-gray-50",
        focusBorderColor: "border-l-gray-900",
        hoverBorderColor: "hover:border-l-gray-400",
      };
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
      onDragStart,
      onDragOver,
      onDrop,
      className,
    },
    ref,
  ) => {
    const { focusBgColor, focusBorderColor, hoverBorderColor } = getCellStyling(cellType);

    return (
      <div
        ref={ref}
        data-slot="cell-container"
        data-cell-id={id}
        className={cn(
          "cell-container group relative border-l-2 transition-all duration-200",
          isFocused
            ? [focusBgColor, focusBorderColor]
            : ["border-l-transparent", hoverBorderColor],
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
