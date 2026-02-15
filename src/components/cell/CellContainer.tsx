import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type GutterColorConfig, getGutterColors } from "./gutter-colors";

interface CellContainerProps {
  id: string;
  cellType: string;
  isFocused?: boolean;
  onFocus?: () => void;
  children: ReactNode;
  /** Content to render in the left gutter action area (e.g., play button, execution count) */
  gutterContent?: ReactNode;
  /** Content to render in the right margin (e.g., cell controls, kebab menu) */
  rightGutterContent?: ReactNode;
  /** Custom color configuration for cell types not in defaults */
  customGutterColors?: Record<string, GutterColorConfig>;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  className?: string;
}

export const CellContainer = forwardRef<HTMLDivElement, CellContainerProps>(
  (
    {
      id,
      cellType,
      isFocused = false,
      onFocus,
      children,
      gutterContent,
      rightGutterContent,
      customGutterColors,
      onDragStart,
      onDragOver,
      onDrop,
      className,
    },
    ref,
  ) => {
    const colors = getGutterColors(cellType, customGutterColors);
    const ribbonColor = isFocused
      ? colors.ribbon.focused
      : colors.ribbon.default;
    const bgColor = isFocused ? colors.background.focused : undefined;

    return (
      <div
        ref={ref}
        data-slot="cell-container"
        data-cell-id={id}
        data-cell-type={cellType}
        className={cn(
          "cell-container group flex transition-colors duration-150",
          bgColor,
          isFocused && "-mx-16 px-16",
          className,
        )}
        onMouseDown={onFocus}
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* Gutter area: action content + thin ribbon */}
        <div className="flex flex-shrink-0">
          {/* Action area - pt-3 matches content padding */}
          <div className="flex w-10 flex-col items-end justify-start gap-0.5 pr-1 pt-3">
            {gutterContent}
          </div>
          {/* Thin ribbon - self-stretch ensures it fills full height */}
          <div
            className={cn(
              "w-1 self-stretch transition-colors duration-150",
              ribbonColor,
            )}
          />
        </div>
        {/* Cell content - more left padding for breathing room after ribbon */}
        <div className="min-w-0 flex-1 py-3 pl-5 pr-3">{children}</div>
        {/* Right margin - pt-3 aligns with left gutter, appears on hover/focus */}
        {rightGutterContent && (
          <div
            className={cn(
              "flex w-10 flex-shrink-0 flex-col items-center gap-1 pt-3",
              "opacity-100 transition-opacity duration-150",
              "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100",
              isFocused && "sm:opacity-100",
            )}
          >
            {rightGutterContent}
          </div>
        )}
      </div>
    );
  },
);

CellContainer.displayName = "CellContainer";
