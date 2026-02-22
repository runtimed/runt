import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Status of a cell in the queue */
export type CellQueueStatus = "pending" | "executing";

/** A cell in the execution queue */
export interface QueuedCell {
  cell_id: string;
  status: CellQueueStatus;
  position: number;
}

/** Queue state emitted from backend */
export interface ExecutionQueueState {
  /** Is the queue processing (has pending or executing cells)? */
  processing: boolean;
  /** Cells currently in queue (pending + executing) */
  cells: QueuedCell[];
  /** ID of currently executing cell (if any) */
  executing_cell_id: string | null;
}

/** Event payload when cells are cancelled */
interface CellsCancelledEvent {
  cell_ids: string[];
}

interface UseExecutionQueueOptions {
  /** Callback when cells are cancelled from the queue */
  onCellsCancelled?: (cellIds: string[]) => void;
}

export function useExecutionQueue(options: UseExecutionQueueOptions = {}) {
  const [queueState, setQueueState] = useState<ExecutionQueueState>({
    processing: false,
    cells: [],
    executing_cell_id: null,
  });

  // Listen for queue state updates
  useEffect(() => {
    let cancelled = false;

    // Listen for queue state changes
    const stateUnlisten = listen<ExecutionQueueState>(
      "queue:state",
      (event) => {
        if (cancelled) return;
        console.log("[queue] state update:", event.payload);
        setQueueState(event.payload);
      },
    );

    // Listen for cells cancelled
    const cancelUnlisten = listen<CellsCancelledEvent>(
      "queue:cells_cancelled",
      (event) => {
        if (cancelled) return;
        console.log("[queue] cells cancelled:", event.payload.cell_ids);
        options.onCellsCancelled?.(event.payload.cell_ids);
      },
    );

    // Load initial state
    invoke<ExecutionQueueState>("get_execution_queue_state")
      .then((state) => {
        if (!cancelled) {
          console.log("[queue] initial state:", state);
          setQueueState(state);
        }
      })
      .catch((e) => {
        console.error("[queue] failed to get initial state:", e);
      });

    return () => {
      cancelled = true;
      stateUnlisten.then((fn) => fn());
      cancelUnlisten.then((fn) => fn());
    };
  }, [options.onCellsCancelled]);

  /** Queue a cell for execution */
  const queueCell = useCallback(async (cellId: string) => {
    console.log("[queue] queueing cell:", cellId);
    try {
      await invoke("queue_execute_cell", { cellId });
    } catch (e) {
      console.error("[queue] queue_execute_cell failed:", e);
    }
  }, []);

  /** Clear all pending cells from the queue */
  const clearQueue = useCallback(async () => {
    console.log("[queue] clearing queue");
    try {
      await invoke("clear_execution_queue");
    } catch (e) {
      console.error("[queue] clear_execution_queue failed:", e);
    }
  }, []);

  /** Queue all code cells for execution in notebook order */
  const runAllCells = useCallback(async (): Promise<string[]> => {
    console.log("[queue] run all cells");
    try {
      return await invoke<string[]>("run_all_cells");
    } catch (e) {
      console.error("[queue] run_all_cells failed:", e);
      return [];
    }
  }, []);

  /** Check if a specific cell is in the queue (pending or executing) */
  const isCellQueued = useCallback(
    (cellId: string) => queueState.cells.some((c) => c.cell_id === cellId),
    [queueState.cells],
  );

  /** Check if a specific cell is currently executing */
  const isCellExecuting = useCallback(
    (cellId: string) => queueState.executing_cell_id === cellId,
    [queueState.executing_cell_id],
  );

  /** Get queue position for a cell (-1 if not in queue) */
  const getCellQueuePosition = useCallback(
    (cellId: string) => {
      const cell = queueState.cells.find((c) => c.cell_id === cellId);
      return cell?.position ?? -1;
    },
    [queueState.cells],
  );

  /** Set of all cell IDs currently in the queue (pending or executing) */
  const queuedCellIds = useMemo(
    () => new Set(queueState.cells.map((c) => c.cell_id)),
    [queueState.cells],
  );

  return {
    /** Current queue state */
    queueState,
    /** Queue a cell for execution */
    queueCell,
    /** Queue all code cells for execution */
    runAllCells,
    /** Clear all pending cells */
    clearQueue,
    /** Check if a cell is queued */
    isCellQueued,
    /** Check if a cell is executing */
    isCellExecuting,
    /** Get cell's position in queue */
    getCellQueuePosition,
    /** Set of all queued cell IDs */
    queuedCellIds,
  };
}
