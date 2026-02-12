import { useCallback, useRef } from "react";
import { Plus } from "lucide-react";
import { CodeCell } from "./CodeCell";
import { MarkdownCell } from "./MarkdownCell";
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
    <div className="flex items-center justify-center gap-1 py-0.5 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={() => onAdd("code", afterCellId)}
        className="flex items-center gap-0.5 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-2.5 w-2.5" />
        Code
      </button>
      <button
        type="button"
        onClick={() => onAdd("markdown", afterCellId)}
        className="flex items-center gap-0.5 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-2.5 w-2.5" />
        Markdown
      </button>
    </div>
  );
}

export function NotebookView({
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

  const renderCell = useCallback(
    (cell: NotebookCell) => {
      const isFocused = cell.id === focusedCellId;
      const isExecuting = executingCellIds.has(cell.id);

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
      onFocusCell,
      onUpdateCellSource,
      onExecuteCell,
      onInterruptKernel,
      onDeleteCell,
    ]
  );

  return (
    <div ref={containerRef} className="max-w-4xl mx-auto px-4 py-4">
      {cells.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">Empty notebook</p>
          <p className="text-xs mt-1">Add a cell to get started</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => onAddCell("code")}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
            >
              <Plus className="h-3 w-3" />
              Code Cell
            </button>
            <button
              type="button"
              onClick={() => onAddCell("markdown")}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
            >
              <Plus className="h-3 w-3" />
              Markdown Cell
            </button>
          </div>
        </div>
      ) : (
        <>
          {cells.map((cell, index) => (
            <div key={cell.id}>
              {index === 0 && (
                <AddCellButtons afterCellId={null} onAdd={onAddCell} />
              )}
              {renderCell(cell)}
              <AddCellButtons afterCellId={cell.id} onAdd={onAddCell} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
