import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import type { JupyterOutput, NotebookCell } from "../types";

/**
 * Snapshot of a cell from the Automerge sync client.
 * Matches the Rust CellSnapshot struct.
 */
interface CellSnapshot {
  id: string;
  cell_type: string;
  source: string;
  execution_count: string; // "5" or "null"
  outputs: string[]; // JSON-encoded Jupyter outputs
}

/**
 * Convert a CellSnapshot from Automerge to a NotebookCell for React state.
 */
function cellSnapshotToNotebookCell(snap: CellSnapshot): NotebookCell {
  const executionCount =
    snap.execution_count === "null"
      ? null
      : Number.parseInt(snap.execution_count, 10);

  const outputs: JupyterOutput[] = snap.outputs
    .map((outputJson) => {
      try {
        return JSON.parse(outputJson) as JupyterOutput;
      } catch {
        console.warn(
          "[notebook-sync] Failed to parse output JSON:",
          outputJson,
        );
        return null;
      }
    })
    .filter((o): o is JupyterOutput => o !== null);

  if (snap.cell_type === "code") {
    return {
      id: snap.id,
      cell_type: "code",
      source: snap.source,
      execution_count: Number.isNaN(executionCount) ? null : executionCount,
      outputs,
    };
  }
  // markdown or raw
  return {
    id: snap.id,
    cell_type: snap.cell_type as "markdown" | "raw",
    source: snap.source,
  };
}

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

  // Listen for backend-initiated cell source updates (e.g., from formatting)
  useEffect(() => {
    const unlisten = listen<{ cell_id: string; source: string }>(
      "cell:source_updated",
      (event) => {
        setCells((prev) =>
          prev.map((c) =>
            c.id === event.payload.cell_id
              ? { ...c, source: event.payload.source }
              : c,
          ),
        );
        setDirty(true);
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for backend-initiated bulk output clearing (run all / restart & run all)
  useEffect(() => {
    const unlisten = listen<string[]>("cells:outputs_cleared", (event) => {
      const clearedIds = new Set(event.payload);
      setCells((prev) =>
        prev.map((c) =>
          clearedIds.has(c.id) && c.cell_type === "code"
            ? { ...c, outputs: [], execution_count: null }
            : c,
        ),
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for cross-window sync updates from the Automerge daemon
  useEffect(() => {
    const unlisten = listen<CellSnapshot[]>("notebook:updated", (event) => {
      console.log(
        "[notebook-sync] Received notebook:updated with",
        event.payload.length,
        "cells",
      );
      // Trust Automerge as source of truth for cross-window sync.
      // Note: This may cause brief output flicker on the executing window
      // while waiting for iopub → Automerge round-trip. A cleaner solution
      // would be daemon-managed kernel execution (future phase).
      const newCells = event.payload.map(cellSnapshotToNotebookCell);
      setCells(newCells);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const updateCellSource = useCallback((cellId: string, source: string) => {
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, source } : c)),
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
          : c,
      ),
    );
  }, []);

  const executeCell = useCallback(
    async (cellId: string) => {
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
    },
    [clearCellOutputs],
  );

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
    [],
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

  const appendOutput = useCallback((cellId: string, output: JupyterOutput) => {
    setCells((prev) =>
      prev.map((c) => {
        if (c.id !== cellId || c.cell_type !== "code") return c;
        const outputs = [...c.outputs];
        // Merge consecutive stream outputs of the same name
        if (output.output_type === "stream" && outputs.length > 0) {
          const last = outputs[outputs.length - 1];
          if (last.output_type === "stream" && last.name === output.name) {
            outputs[outputs.length - 1] = {
              ...last,
              text: last.text + output.text,
            };
            return { ...c, outputs };
          }
        }
        return { ...c, outputs: [...outputs, output] };
      }),
    );
  }, []);

  const updateOutputByDisplayId = useCallback(
    (
      displayId: string,
      newData: Record<string, unknown>,
      newMetadata?: Record<string, unknown>,
    ) => {
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
        }),
      );
    },
    [],
  );

  const setExecutionCount = useCallback((cellId: string, count: number) => {
    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId && c.cell_type === "code"
          ? { ...c, execution_count: count }
          : c,
      ),
    );
  }, []);

  /**
   * Format a cell's source code using the appropriate formatter.
   * The backend handles the formatting and emits a cell:source_updated event
   * if the source changed, which updates the React state automatically.
   */
  const formatCell = useCallback(async (cellId: string) => {
    try {
      const result = await invoke<{
        source: string;
        changed: boolean;
        error: string | null;
      }>("format_cell", { cellId });

      if (result.error) {
        console.warn("[notebook] format_cell warning:", result.error);
      }

      return result;
    } catch (e) {
      console.error("[notebook] format_cell failed:", e);
      return null;
    }
  }, []);

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
    formatCell,
  };
}
