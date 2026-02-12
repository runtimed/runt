import { useState, useCallback, useRef } from "react";
import type { KeyBinding } from "@codemirror/view";
import { CellContainer } from "@/components/cell/CellContainer";
import {
  CodeMirrorEditor,
  type CodeMirrorEditorRef,
} from "@/components/editor/codemirror-editor";
import { MarkdownOutput } from "@/components/outputs/markdown-output";
import { Trash2, Pencil } from "lucide-react";
import type { MarkdownCell as MarkdownCellType } from "../types";

interface MarkdownCellProps {
  cell: MarkdownCellType;
  isFocused: boolean;
  onFocus: () => void;
  onUpdateSource: (source: string) => void;
  onDelete: () => void;
}

export function MarkdownCell({
  cell,
  isFocused,
  onFocus,
  onUpdateSource,
  onDelete,
}: MarkdownCellProps) {
  const [editing, setEditing] = useState(cell.source === "");
  const editorRef = useRef<CodeMirrorEditorRef>(null);

  const handleDoubleClick = useCallback(() => {
    setEditing(true);
  }, []);

  const handleBlur = useCallback(() => {
    if (cell.source.trim()) {
      setEditing(false);
    }
  }, [cell.source]);

  const keyMap: KeyBinding[] = [
    {
      key: "Shift-Enter",
      run: () => {
        if (cell.source.trim()) {
          setEditing(false);
        }
        return true;
      },
    },
    {
      key: "Escape",
      run: () => {
        if (cell.source.trim()) {
          setEditing(false);
        }
        return true;
      },
    },
  ];

  return (
    <CellContainer
      id={cell.id}
      isFocused={isFocused}
      onFocus={onFocus}
      className="rounded-md my-1"
    >
      {editing ? (
        <>
          <div className="flex items-center gap-1 px-2 py-1">
            <span className="text-xs text-muted-foreground font-mono">md</span>
            <div className="flex-1" />
            {isFocused && (
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center justify-center rounded p-1 text-muted-foreground/40 transition-colors hover:text-destructive"
                title="Delete cell"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="border-t border-border/50 px-1">
            <CodeMirrorEditor
              ref={editorRef}
              value={cell.source}
              language="markdown"
              onValueChange={onUpdateSource}
              onBlur={handleBlur}
              keyMap={keyMap}
              placeholder="Enter markdown..."
              className="min-h-[2rem]"
              autoFocus
            />
          </div>
        </>
      ) : (
        <div
          className="px-4 py-2 prose prose-sm max-w-none cursor-text relative group/md"
          onDoubleClick={handleDoubleClick}
        >
          {cell.source ? (
            <MarkdownOutput content={cell.source} />
          ) : (
            <p className="text-muted-foreground italic">
              Double-click to edit
            </p>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="absolute top-2 right-2 opacity-0 group-hover/md:opacity-100 rounded p-1 text-muted-foreground transition-opacity hover:text-foreground"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </CellContainer>
  );
}
