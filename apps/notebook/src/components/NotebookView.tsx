import { useCallback, useRef, useMemo } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeCell } from "./CodeCell";
import { MarkdownCell } from "./MarkdownCell";
import { EditorRegistryProvider, useEditorRegistry } from "../hooks/useEditorRegistry";
import type { NotebookCell } from "../types";

interface NotebookViewProps {
  cells: NotebookCell[];
  focusedCellId: string | null;
  executingCellIds: Set<string>;
  onFocusCell: (cellId: string) => void;
  onUpdateCellSource: (cellId: string, source: string) => void;
  onExecuteCell: (cellId: string) => void;
  onInterruptKernel: () => void;
  onDeleteCell: (cellId: string) => void;
  onAddCell: (type: "code" | "markdown", afterCellId?: string | null) => void;
}

function AddCellButtons({
  afterCellId,
  onAdd,
}: {
  afterCellId?: string | null;
  onAdd: (type: "code" | "markdown", afterCellId?: string | null) => void;
}) {
  return (
    <div className="group/betweener flex h-4 w-full items-center">
      {/* Gutter spacer - matches cell gutter: action area + ribbon */}
      <div className="flex-shrink-0 flex h-full">
        <div className="w-6" />
        <div className="w-1 bg-gray-200" />
      </div>
      {/* Content area with centered buttons */}
      <div className="flex-1 relative flex items-center justify-center">
        {/* Thin line appears on hover */}
        <div className="absolute inset-x-0 h-px bg-transparent group-hover/betweener:bg-border transition-colors" />
        {/* Buttons appear on hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover/betweener:opacity-100 transition-opacity z-10 bg-background px-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onAdd("code", afterCellId)}
          >
            <Plus className="h-3 w-3" />
            Code
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onAdd("markdown", afterCellId)}
          >
            <Plus className="h-3 w-3" />
            Markdown
          </Button>
        </div>
      </div>
    </div>
  );
}

function NotebookViewContent({
  cells,
  focusedCellId,
  executingCellIds,
  onFocusCell,
  onUpdateCellSource,
  onExecuteCell,
  onInterruptKernel,
  onDeleteCell,
  onAddCell,
}: NotebookViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { focusCell } = useEditorRegistry();

  // Memoize cell IDs array
  const cellIds = useMemo(() => cells.map((c) => c.id), [cells]);

  const renderCell = useCallback(
    (cell: NotebookCell, index: number) => {
      const isFocused = cell.id === focusedCellId;
      const isExecuting = executingCellIds.has(cell.id);

      // Navigation callbacks
      const onFocusPrevious = (cursorPosition: "start" | "end") => {
        if (index > 0) {
          const prevCellId = cellIds[index - 1];
          onFocusCell(prevCellId);
          focusCell(prevCellId, cursorPosition);
        }
      };

      const onFocusNext = (cursorPosition: "start" | "end") => {
        if (index < cellIds.length - 1) {
          const nextCellId = cellIds[index + 1];
          onFocusCell(nextCellId);
          focusCell(nextCellId, cursorPosition);
        }
      };

      if (cell.cell_type === "code") {
        return (
          <CodeCell
            key={cell.id}
            cell={cell}
            isFocused={isFocused}
            isExecuting={isExecuting}
            onFocus={() => onFocusCell(cell.id)}
            onUpdateSource={(source) => onUpdateCellSource(cell.id, source)}
            onExecute={() => onExecuteCell(cell.id)}
            onInterrupt={onInterruptKernel}
            onDelete={() => onDeleteCell(cell.id)}
            onFocusPrevious={onFocusPrevious}
            onFocusNext={onFocusNext}
            onInsertCellAfter={() => onAddCell("code", cell.id)}
            isLastCell={index === cells.length - 1}
          />
        );
      }

      if (cell.cell_type === "markdown") {
        return (
          <MarkdownCell
            key={cell.id}
            cell={cell}
            isFocused={isFocused}
            onFocus={() => onFocusCell(cell.id)}
            onUpdateSource={(source) => onUpdateCellSource(cell.id, source)}
            onDelete={() => onDeleteCell(cell.id)}
            onFocusPrevious={onFocusPrevious}
            onFocusNext={onFocusNext}
            onInsertCellAfter={() => onAddCell("markdown", cell.id)}
            isLastCell={index === cells.length - 1}
          />
        );
      }

      // Raw cells rendered as plain text for now
      return (
        <div
          key={cell.id}
          className="px-4 py-2"
        >
          <pre className="text-sm text-muted-foreground whitespace-pre-wrap">
            {cell.source}
          </pre>
        </div>
      );
    },
    [
      focusedCellId,
      executingCellIds,
      cellIds,
      cells.length,
      onFocusCell,
      onUpdateCellSource,
      onExecuteCell,
      onInterruptKernel,
      onDeleteCell,
      onAddCell,
      focusCell,
    ]
  );

  return (
    <div ref={containerRef} className="max-w-4xl mx-auto px-4 py-4">
      {cells.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">Empty notebook</p>
          <p className="text-xs mt-1">Add a cell to get started</p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddCell("code")}
              className="gap-1"
            >
              <Plus className="h-3 w-3" />
              Code Cell
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddCell("markdown")}
              className="gap-1"
            >
              <Plus className="h-3 w-3" />
              Markdown Cell
            </Button>
          </div>
        </div>
      ) : (
        <>
          {cells.map((cell, index) => (
            <div key={cell.id}>
              {index === 0 && (
                <AddCellButtons afterCellId={null} onAdd={onAddCell} />
              )}
              {renderCell(cell, index)}
              <AddCellButtons afterCellId={cell.id} onAdd={onAddCell} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function NotebookView(props: NotebookViewProps) {
  return (
    <EditorRegistryProvider>
      <NotebookViewContent {...props} />
    </EditorRegistryProvider>
  );
}
