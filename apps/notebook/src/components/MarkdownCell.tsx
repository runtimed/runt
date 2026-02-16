import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { KeyBinding } from "@codemirror/view";
import { CellContainer } from "@/components/cell/CellContainer";
import {
  CodeMirrorEditor,
  type CodeMirrorEditorRef,
} from "@/components/editor/codemirror-editor";
import {
  IsolatedFrame,
  type IsolatedFrameHandle,
} from "@/components/outputs/isolated";
import { isDarkMode as detectDarkMode } from "@/components/themes";
import { Trash2, Pencil } from "lucide-react";
import { useCellKeyboardNavigation } from "../hooks/useCellKeyboardNavigation";
import { useEditorRegistry } from "../hooks/useEditorRegistry";
import type { MarkdownCell as MarkdownCellType } from "../types";

interface MarkdownCellProps {
  cell: MarkdownCellType;
  isFocused: boolean;
  onFocus: () => void;
  onUpdateSource: (source: string) => void;
  onDelete: () => void;
  onFocusPrevious?: (cursorPosition: "start" | "end") => void;
  onFocusNext?: (cursorPosition: "start" | "end") => void;
  onInsertCellAfter?: () => void;
  isLastCell?: boolean;
}

export function MarkdownCell({
  cell,
  isFocused,
  onFocus,
  onUpdateSource,
  onDelete,
  onFocusPrevious,
  onFocusNext,
  onInsertCellAfter,
  isLastCell = false,
}: MarkdownCellProps) {
  const [editing, setEditing] = useState(cell.source === "");
  const editorRef = useRef<CodeMirrorEditorRef>(null);
  const frameRef = useRef<IsolatedFrameHandle>(null);
  const { registerEditor, unregisterEditor } = useEditorRegistry();

  // Track dark mode state for iframe theme sync
  const [darkMode, setDarkMode] = useState(() => detectDarkMode());

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDarkMode(detectDarkMode());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-mode"],
    });
    return () => observer.disconnect();
  }, []);

  // Register editor with the registry for cross-cell navigation
  useEffect(() => {
    if (editing && editorRef.current) {
      registerEditor(cell.id, {
        focus: () => editorRef.current?.focus(),
        setCursorPosition: (position) =>
          editorRef.current?.setCursorPosition(position),
      });
    }
    return () => unregisterEditor(cell.id);
  }, [cell.id, editing, registerEditor, unregisterEditor]);

  const handleDoubleClick = useCallback(() => {
    setEditing(true);
  }, []);

  const handleBlur = useCallback(() => {
    if (cell.source.trim()) {
      setEditing(false);
    }
  }, [cell.source]);

  // Render markdown content when iframe is ready
  const handleFrameReady = useCallback(() => {
    if (!frameRef.current || !cell.source) return;
    frameRef.current.render({
      mimeType: "text/markdown",
      data: cell.source,
    });
  }, [cell.source]);

  // Re-render when source changes and not editing
  useEffect(() => {
    if (!editing && frameRef.current?.isReady && cell.source) {
      frameRef.current.render({
        mimeType: "text/markdown",
        data: cell.source,
      });
    }
  }, [editing, cell.source]);

  // Handle link clicks from iframe
  const handleLinkClick = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  // Handle focus next, creating a new cell if at the end
  const handleFocusNextOrCreate = useCallback(
    (cursorPosition: "start" | "end") => {
      // For markdown, close edit mode first
      if (cell.source.trim()) {
        setEditing(false);
      }
      if (isLastCell && onInsertCellAfter) {
        onInsertCellAfter();
      } else if (onFocusNext) {
        onFocusNext(cursorPosition);
      }
    },
    [cell.source, isLastCell, onFocusNext, onInsertCellAfter]
  );

  // Get keyboard navigation bindings
  const navigationKeyMap = useCellKeyboardNavigation({
    onFocusPrevious: onFocusPrevious ?? (() => {}),
    onFocusNext: handleFocusNextOrCreate,
    onExecute: () => {}, // No-op for markdown, enables Shift+Enter navigation
    onDelete,
  });

  // Combine navigation with markdown-specific keys
  const keyMap: KeyBinding[] = useMemo(
    () => [
      ...navigationKeyMap,
      {
        key: "Escape",
        run: () => {
          if (cell.source.trim()) {
            setEditing(false);
          }
          return true;
        },
      },
    ],
    [navigationKeyMap, cell.source]
  );

  return (
    <CellContainer
      id={cell.id}
      cellType="markdown"
      isFocused={isFocused}
      onFocus={onFocus}
    >
      {editing ? (
        <>
          <div className="flex items-center gap-1 py-1">
            <span className="text-xs text-muted-foreground font-mono">md</span>
            <div className="flex-1" />
            <div className="cell-controls opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center justify-center rounded p-1 text-muted-foreground/40 transition-colors hover:text-destructive"
                title="Delete cell"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div>
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
          className="py-2 cursor-text relative group/md"
          onDoubleClick={handleDoubleClick}
        >
          {cell.source ? (
            <IsolatedFrame
              ref={frameRef}
              darkMode={darkMode}
              useReactRenderer={true}
              minHeight={24}
              maxHeight={2000}
              onReady={handleFrameReady}
              onLinkClick={handleLinkClick}
              onDoubleClick={handleDoubleClick}
              onError={(err) => console.error("[MarkdownCell] iframe error:", err)}
              className="w-full"
            />
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
