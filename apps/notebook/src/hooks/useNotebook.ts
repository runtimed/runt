import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { NotebookCell, JupyterOutput } from "../types";

export function useNotebook() {
  const [cells, setCells] = useState<NotebookCell[]>([]);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    invoke<NotebookCell[]>("load_notebook").then((loadedCells) => {
      setCells(loadedCells);
      if (loadedCells.length > 0) {
        setFocusedCellId(loadedCells[0].id);
      }
    }).catch(console.error);
  }, []);

  const updateCellSource = useCallback((cellId: string, source: string) => {
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, source } : c))
    );
    setDirty(true);
    invoke("update_cell_source", { cellId, source }).catch(console.error);
  }, []);

  const executeCell = useCallback(async (cellId: string) => {
    console.log("[notebook] executeCell:", cellId);
    // Clear old outputs and mark running
    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId && c.cell_type === "code"
          ? { ...c, outputs: [], execution_count: null }
          : c
      )
    );
    try {
      const msgId = await invoke<string>("execute_cell", { cellId });
      console.log("[notebook] execute_cell returned msg_id:", msgId);
      return msgId;
    } catch (e) {
      console.error("[notebook] execute_cell failed:", e);
      return null;
    }
  }, []);

  const addCell = useCallback(
    async (cellType: "code" | "markdown", afterCellId?: string | null) => {
      try {
        const newCell = await invoke<NotebookCell>("add_cell", {
          cellType,
          afterCellId: afterCellId ?? null,
        });
        setCells((prev) => {
          if (!afterCellId) return [newCell, ...prev];
          const idx = prev.findIndex((c) => c.id === afterCellId);
          if (idx === -1) return [newCell, ...prev];
          const next = [...prev];
          next.splice(idx + 1, 0, newCell);
          return next;
        });
        setFocusedCellId(newCell.id);
        setDirty(true);
        return newCell;
      } catch (e) {
        console.error("add_cell failed:", e);
        return null;
      }
    },
    []
  );

  const deleteCell = useCallback(async (cellId: string) => {
    try {
      await invoke("delete_cell", { cellId });
      setCells((prev) => prev.filter((c) => c.id !== cellId));
      setDirty(true);
    } catch (e) {
      console.error("delete_cell failed:", e);
    }
  }, []);

  const save = useCallback(async () => {
    try {
      // Check if we have a file path
      const hasPath = await invoke<boolean>("has_notebook_path");

      if (hasPath) {
        // Save to existing path
        await invoke("save_notebook");
      } else {
        // Show Save As dialog
        const filePath = await saveDialog({
          filters: [{ name: "Jupyter Notebook", extensions: ["ipynb"] }],
          defaultPath: "Untitled.ipynb",
        });

        if (!filePath) {
          // User cancelled
          return;
        }

        // Save to the selected path
        await invoke("save_notebook_as", { path: filePath });
      }

      setDirty(false);
    } catch (e) {
      console.error("save_notebook failed:", e);
    }
  }, []);

  const appendOutput = useCallback(
    (cellId: string, output: JupyterOutput) => {
      setCells((prev) =>
        prev.map((c) => {
          if (c.id !== cellId || c.cell_type !== "code") return c;
          const outputs = [...c.outputs];
          // Merge consecutive stream outputs of the same name
          if (
            output.output_type === "stream" &&
            outputs.length > 0
          ) {
            const last = outputs[outputs.length - 1];
            if (
              last.output_type === "stream" &&
              last.name === output.name
            ) {
              outputs[outputs.length - 1] = {
                ...last,
                text: last.text + output.text,
              };
              return { ...c, outputs };
            }
          }
          return { ...c, outputs: [...outputs, output] };
        })
      );
    },
    []
  );

  const setExecutionCount = useCallback(
    (cellId: string, count: number) => {
      setCells((prev) =>
        prev.map((c) =>
          c.id === cellId && c.cell_type === "code"
            ? { ...c, execution_count: count }
            : c
        )
      );
    },
    []
  );

  return {
    cells,
    setCells,
    focusedCellId,
    setFocusedCellId,
    updateCellSource,
    executeCell,
    addCell,
    deleteCell,
    save,
    dirty,
    appendOutput,
    setExecutionCount,
  };
}
