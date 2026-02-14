import { useCallback, useRef, useEffect, useMemo } from "react";
import type { KeyBinding } from "@codemirror/view";
import { CellContainer } from "@/components/cell/CellContainer";
import { CompactExecutionButton } from "@/components/cell/CompactExecutionButton";
import { OutputArea } from "@/components/cell/OutputArea";
import { AnsiOutput } from "@/components/outputs/ansi-output";
import {
  CodeMirrorEditor,
  type CodeMirrorEditorRef,
} from "@/components/editor/codemirror-editor";
import { Trash2, X } from "lucide-react";
import { kernelCompletionExtension } from "../lib/kernel-completion";
import { useCellKeyboardNavigation } from "../hooks/useCellKeyboardNavigation";
import { useEditorRegistry } from "../hooks/useEditorRegistry";
import type { CodeCell as CodeCellType } from "../types";
import type { CellPagePayload } from "../App";
import type { MimeBundle } from "../hooks/useKernel";

/** Page payload display component - Zed REPL style */
function PagePayloadDisplay({
  data,
  onDismiss,
}: {
  data: MimeBundle;
  onDismiss: () => void;
}) {
  const htmlContent = data["text/html"];
  const textContent = data["text/plain"];

  return (
    <div className="cm-page-payload">
      <div className="cm-page-payload-content">
        {typeof htmlContent === "string" ? (
          <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
        ) : typeof textContent === "string" ? (
          <AnsiOutput className="cm-page-payload-text">{textContent}</AnsiOutput>
        ) : (
          <pre className="cm-page-payload-text">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
      <div className="cm-page-payload-gutter">
        <button
          type="button"
          className="cm-page-payload-dismiss"
          onClick={onDismiss}
          title="Dismiss (Escape)"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

interface CodeCellProps {
  cell: CodeCellType;
  isFocused: boolean;
  isExecuting: boolean;
  pagePayload: CellPagePayload | null;
  onFocus: () => void;
  onUpdateSource: (source: string) => void;
  onExecute: () => void;
  onInterrupt: () => void;
  onDelete: () => void;
  onFocusPrevious?: (cursorPosition: "start" | "end") => void;
  onFocusNext?: (cursorPosition: "start" | "end") => void;
  onInsertCellAfter?: () => void;
  onClearPagePayload?: () => void;
  isLastCell?: boolean;
}

export function CodeCell({
  cell,
  isFocused,
  isExecuting,
  pagePayload,
  onFocus,
  onUpdateSource,
  onExecute,
  onInterrupt,
  onDelete,
  onFocusPrevious,
  onFocusNext,
  onInsertCellAfter,
  onClearPagePayload,
  isLastCell = false,
}: CodeCellProps) {
  const editorRef = useRef<CodeMirrorEditorRef>(null);
  const { registerEditor, unregisterEditor } = useEditorRegistry();

  // Register editor with the registry for cross-cell navigation
  useEffect(() => {
    if (editorRef.current) {
      registerEditor(cell.id, {
        focus: () => editorRef.current?.focus(),
        setCursorPosition: (position) =>
          editorRef.current?.setCursorPosition(position),
      });
    }
    return () => unregisterEditor(cell.id);
  }, [cell.id, registerEditor, unregisterEditor]);

  // Handle Escape key to dismiss page payload
  useEffect(() => {
    if (!pagePayload || !isFocused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClearPagePayload?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pagePayload, isFocused, onClearPagePayload]);

  // Clear page payload when cell is executed (before new results come in)
  const handleExecuteWithClear = useCallback(() => {
    onClearPagePayload?.();
    onExecute();
  }, [onExecute, onClearPagePayload]);

  // Handle focus next, creating a new cell if at the end
  const handleFocusNextOrCreate = useCallback(
    (cursorPosition: "start" | "end") => {
      if (isLastCell && onInsertCellAfter) {
        onInsertCellAfter();
      } else if (onFocusNext) {
        onFocusNext(cursorPosition);
      }
    },
    [isLastCell, onFocusNext, onInsertCellAfter]
  );

  // Get keyboard navigation bindings
  const navigationKeyMap = useCellKeyboardNavigation({
    onFocusPrevious: onFocusPrevious ?? (() => {}),
    onFocusNext: handleFocusNextOrCreate,
    onExecute: handleExecuteWithClear,
    onExecuteAndInsert: onInsertCellAfter
      ? () => {
          handleExecuteWithClear();
          onInsertCellAfter();
        }
      : undefined,
  });

  // Merge navigation keybindings (navigation bindings take precedence for Shift-Enter)
  const keyMap: KeyBinding[] = useMemo(
    () => [...navigationKeyMap],
    [navigationKeyMap]
  );

  const handleExecute = useCallback(() => {
    handleExecuteWithClear();
  }, [handleExecuteWithClear]);

  const gutterContent = (
    <CompactExecutionButton
      count={cell.execution_count}
      isExecuting={isExecuting}
      onExecute={handleExecute}
      onInterrupt={onInterrupt}
    />
  );

  const rightGutterContent = (
    <button
      type="button"
      onClick={onDelete}
      className="flex items-center justify-center rounded p-1 text-muted-foreground/40 transition-colors hover:text-destructive"
      title="Delete cell"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <CellContainer
      id={cell.id}
      cellType="code"
      isFocused={isFocused}
      onFocus={onFocus}
      gutterContent={gutterContent}
      rightGutterContent={rightGutterContent}
    >
      {/* Editor */}
      <div>
        <CodeMirrorEditor
          ref={editorRef}
          value={cell.source}
          language="python"
          onValueChange={onUpdateSource}
          keyMap={keyMap}
          extensions={[kernelCompletionExtension]}
          placeholder="Enter code..."
          className="min-h-[2rem]"
          autoFocus={isFocused}
        />
      </div>

      {/* Page Payload (documentation from ? or ??) */}
      {pagePayload && (
        <div className="px-2 py-1">
          <PagePayloadDisplay
            data={pagePayload.data}
            onDismiss={() => onClearPagePayload?.()}
          />
        </div>
      )}

      {/* Outputs */}
      {cell.outputs.length > 0 && (
        <div className="py-2">
          <OutputArea outputs={cell.outputs} />
        </div>
      )}
    </CellContainer>
  );
}
