import { useCallback, useRef } from "react";
import type { KeyBinding } from "@codemirror/view";
import { CellContainer } from "@runtimed/ui/components/cell/CellContainer";
import { PlayButton } from "@runtimed/ui/components/cell/PlayButton";
import { ExecutionCount } from "@runtimed/ui/components/cell/ExecutionCount";
import { OutputArea } from "@runtimed/ui/components/cell/OutputArea";
import {
  CodeMirrorEditor,
  type CodeMirrorEditorRef,
} from "@runtimed/ui/components/editor/codemirror-editor";
import { Trash2 } from "lucide-react";
import { kernelCompletionExtension } from "../lib/kernel-completion";
import type { CodeCell as CodeCellType } from "../types";

interface CodeCellProps {
  cell: CodeCellType;
  isFocused: boolean;
  isExecuting: boolean;
  onFocus: () => void;
  onUpdateSource: (source: string) => void;
  onExecute: () => void;
  onInterrupt: () => void;
  onDelete: () => void;
}

export function CodeCell({
  cell,
  isFocused,
  isExecuting,
  onFocus,
  onUpdateSource,
  onExecute,
  onInterrupt,
  onDelete,
}: CodeCellProps) {
  const editorRef = useRef<CodeMirrorEditorRef>(null);

  const keyMap: KeyBinding[] = [
    {
      key: "Shift-Enter",
      run: () => {
        onExecute();
        return true;
      },
    },
  ];

  const handleExecute = useCallback(() => {
    onExecute();
  }, [onExecute]);

  return (
    <CellContainer
      id={cell.id}
      isFocused={isFocused}
      onFocus={onFocus}
      className="rounded-md my-1"
    >
      {/* Cell header: execution count + play button */}
      <div className="flex items-center gap-1 px-2 py-1">
        <ExecutionCount
          count={cell.execution_count}
          isExecuting={isExecuting}
          className="text-xs"
        />
        <div className="flex-1" />
        <PlayButton
          executionState={isExecuting ? "running" : "idle"}
          cellType="code"
          isFocused={isFocused}
          onExecute={handleExecute}
          onInterrupt={onInterrupt}
          className="h-6 w-6"
        />
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

      {/* Editor */}
      <div className="border-t border-border/50 px-1">
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

      {/* Outputs */}
      {cell.outputs.length > 0 && (
        <div className="border-t border-border/50 px-2 py-1">
          <OutputArea outputs={cell.outputs} />
        </div>
      )}
    </CellContainer>
  );
}
