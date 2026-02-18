import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import type { NotebookCell, JupyterOutput } from "../types";

export function useNotebook() {
  const [cells, setCells] = useState<NotebookCell[]>([]);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadCells = useCallback(() => {
    invoke<NotebookCell[]>("load_notebook")
      .then((loadedCells) => {
        setCells(loadedCells);
        if (loadedCells.length > 0) {
          setFocusedCellId(loadedCells[0].id);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    loadCells();
  }, [loadCells]);

  // Reload cells when a file is opened via OS file association
  useEffect(() => {
    const unlisten = listen("notebook:file-opened", () => {
      loadCells();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadCells]);

  const updateCellSource = useCallback((cellId: string, source: string) => {
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, source } : c))
    );
    setDirty(true);
    invoke("update_cell_source", { cellId, source }).catch(console.error);
  }, []);

  /**
   * Clear outputs and execution count for a cell.
   * Called before queuing a cell for execution to ensure a clean slate.
   */
  const clearCellOutputs = useCallback((cellId: string) => {
    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId && c.cell_type === "code"
          ? { ...c, outputs: [], execution_count: null }
          : c
      )
    );
  }, []);

  const executeCell = useCallback(async (cellId: string) => {
    console.log("[notebook] executeCell:", cellId);
    // Clear old outputs and mark running
    clearCellOutputs(cellId);
    try {
      const msgId = await invoke<string>("execute_cell", { cellId });
      console.log("[notebook] execute_cell returned msg_id:", msgId);
      return msgId;
    } catch (e) {
      console.error("[notebook] execute_cell failed:", e);
      return null;
    }
  }, [clearCellOutputs]);

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

  const openNotebook = useCallback(async () => {
    try {
      const filePath = await openDialog({
        multiple: false,
        filters: [{ name: "Jupyter Notebook", extensions: ["ipynb"] }],
      });

      if (!filePath || typeof filePath !== "string") {
        // User cancelled or unexpected type
        return;
      }

      // Open the notebook in a new window
      await invoke("open_notebook_in_new_window", { path: filePath });
    } catch (e) {
      console.error("open_notebook failed:", e);
    }
  }, []);

  const cloneNotebook = useCallback(async () => {
    try {
      // Show Save dialog for the clone
      const filePath = await saveDialog({
        filters: [{ name: "Jupyter Notebook", extensions: ["ipynb"] }],
        defaultPath: "Untitled-Clone.ipynb",
      });

      if (!filePath) {
        return; // User cancelled
      }

      // Clone notebook with fresh env_id and save to path
      await invoke("clone_notebook_to_path", { path: filePath });

      // Open the cloned notebook in a new window
      await invoke("open_notebook_in_new_window", { path: filePath });
    } catch (e) {
      console.error("clone_notebook failed:", e);
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

  const updateOutputByDisplayId = useCallback(
    (displayId: string, newData: Record<string, unknown>, newMetadata?: Record<string, unknown>) => {
      setCells((prev) =>
        prev.map((c) => {
          if (c.cell_type !== "code") return c;
          let changed = false;
          const updatedOutputs = c.outputs.map((output) => {
            if (
              (output.output_type === "display_data" ||
                output.output_type === "execute_result") &&
              output.display_id === displayId
            ) {
              changed = true;
              return { ...output, data: newData, metadata: newMetadata };
            }
            return output;
          });
          return changed ? { ...c, outputs: updatedOutputs } : c;
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
    clearCellOutputs,
    addCell,
    deleteCell,
    save,
    openNotebook,
    cloneNotebook,
    dirty,
    appendOutput,
    updateOutputByDisplayId,
    setExecutionCount,
  };
}
