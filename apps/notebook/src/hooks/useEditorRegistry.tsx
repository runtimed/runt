import {
  createContext,
  useContext,
  useRef,
  useCallback,
  type ReactNode,
} from "react";

export interface EditorRef {
  focus: () => void;
  setCursorPosition: (position: "start" | "end") => void;
}

interface EditorRegistryContextType {
  registerEditor: (cellId: string, ref: EditorRef) => void;
  unregisterEditor: (cellId: string) => void;
  focusCell: (cellId: string, cursorPosition: "start" | "end") => void;
}

const EditorRegistryContext = createContext<EditorRegistryContextType | null>(
  null
);

export function EditorRegistryProvider({ children }: { children: ReactNode }) {
  const editorsRef = useRef<Map<string, EditorRef>>(new Map());

  const registerEditor = useCallback((cellId: string, ref: EditorRef) => {
    editorsRef.current.set(cellId, ref);
  }, []);

  const unregisterEditor = useCallback((cellId: string) => {
    editorsRef.current.delete(cellId);
  }, []);

  const focusCell = useCallback(
    (cellId: string, cursorPosition: "start" | "end") => {
      const editor = editorsRef.current.get(cellId);
      if (editor) {
        editor.setCursorPosition(cursorPosition);
        editor.focus();
        // Scroll the cell into view
        const cellElement = document.querySelector(
          `[data-cell-id="${cellId}"]`
        );
        if (cellElement) {
          cellElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    },
    []
  );

  return (
    <EditorRegistryContext.Provider
      value={{ registerEditor, unregisterEditor, focusCell }}
    >
      {children}
    </EditorRegistryContext.Provider>
  );
}

export function useEditorRegistry() {
  const context = useContext(EditorRegistryContext);
  if (!context) {
    throw new Error(
      "useEditorRegistry must be used within EditorRegistryProvider"
    );
  }
  return context;
}
