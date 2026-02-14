/**
 * Comm Bridge Manager - Parent Side
 *
 * This module manages the communication bridge between the parent window's
 * widget system and an isolated iframe. It:
 * - Buffers comm messages until iframe sends `widget_ready`
 * - Syncs all existing widget models to iframe on ready
 * - Forwards comm messages from kernel to iframe
 * - Handles widget messages from iframe and updates parent store + kernel
 *
 * Security: The iframe cannot access Tauri APIs directly. All widget
 * communication must go through this controlled postMessage bridge.
 */

import type { WidgetStore } from "@/components/widgets/widget-store";
import type {
  CommOpenMessage,
  CommMsgMessage,
  CommCloseMessage,
  CommSyncMessage,
  IframeToParentMessage,
} from "./frame-bridge";
import type { IsolatedFrameHandle } from "./isolated-frame";

// Type for sending messages to kernel
type SendUpdate = (
  commId: string,
  state: Record<string, unknown>,
  buffers?: ArrayBuffer[]
) => void;

type SendCustom = (
  commId: string,
  content: Record<string, unknown>,
  buffers?: ArrayBuffer[]
) => void;

type CloseComm = (commId: string) => void;

interface CommBridgeManagerOptions {
  /** The isolated frame handle for sending messages */
  frame: IsolatedFrameHandle;
  /** The parent widget store */
  store: WidgetStore;
  /** Function to send state updates to kernel */
  sendUpdate: SendUpdate;
  /** Function to send custom messages to kernel */
  sendCustom: SendCustom;
  /** Function to close a comm with kernel */
  closeComm: CloseComm;
}

/**
 * Comm Bridge Manager for proxying widget communication to an isolated iframe.
 *
 * Usage:
 * 1. Create manager when IsolatedFrame is mounted
 * 2. Subscribe to widget store changes to forward to iframe
 * 3. Handle iframe messages via onMessage callback
 * 4. Dispose when iframe is unmounted
 */
export class CommBridgeManager {
  private frame: IsolatedFrameHandle;
  private store: WidgetStore;
  private sendUpdateToKernel: SendUpdate;
  private sendCustomToKernel: SendCustom;
  private closeCommWithKernel: CloseComm;

  private isWidgetReady = false;
  private messageBuffer: Array<CommOpenMessage | CommMsgMessage | CommCloseMessage> = [];
  private storeUnsubscribe: (() => void) | null = null;

  // Track which models have been sent to avoid duplicate sends
  private sentModels = new Set<string>();

  // Track previous state for each model to detect kernel updates
  private previousState = new Map<string, Record<string, unknown>>();

  // Flag to prevent echoing iframe updates back to iframe
  private isProcessingIframeUpdate = false;

  constructor(options: CommBridgeManagerOptions) {
    this.frame = options.frame;
    this.store = options.store;
    this.sendUpdateToKernel = options.sendUpdate;
    this.sendCustomToKernel = options.sendCustom;
    this.closeCommWithKernel = options.closeComm;

    console.log("[CommBridge] Creating bridge, store has", this.store.getSnapshot().size, "models");

    // Subscribe to store changes to forward to iframe
    this.storeUnsubscribe = this.store.subscribe(() => {
      if (!this.isWidgetReady) return;
      // Skip if this change came from iframe (avoid echo)
      if (this.isProcessingIframeUpdate) return;
      this.syncModels();
    });

    // Signal to iframe that parent bridge is ready
    // Iframe will respond with widget_ready to trigger comm_sync
    console.log("[CommBridge] Sending bridge_ready");
    this.frame.send({ type: "bridge_ready" });
  }

  /**
   * Handle a message from the iframe.
   * Call this from the IsolatedFrame's onMessage callback.
   */
  handleIframeMessage(message: IframeToParentMessage): void {
    console.log("[CommBridge] Received iframe message:", message.type);
    switch (message.type) {
      case "widget_ready":
        this.handleWidgetReady();
        break;

      case "widget_comm_msg":
        this.handleWidgetCommMsg(message.payload);
        break;

      case "widget_comm_close":
        this.handleWidgetCommClose(message.payload);
        break;
    }
  }

  /**
   * Forward a comm_open to the iframe.
   * Called when a widget model is created by the kernel.
   */
  sendCommOpen(
    commId: string,
    targetName: string,
    state: Record<string, unknown>,
    buffers?: ArrayBuffer[]
  ): void {
    const msg: CommOpenMessage = {
      type: "comm_open",
      payload: {
        commId,
        targetName,
        state,
        buffers,
      },
    };

    if (this.isWidgetReady) {
      this.frame.send(msg);
      this.sentModels.add(commId);
    } else {
      this.messageBuffer.push(msg);
    }
  }

  /**
   * Forward a comm_msg (state update or custom message) to the iframe.
   * Called when the kernel sends a state update or custom message.
   */
  sendCommMsg(
    commId: string,
    method: "update" | "custom",
    data: Record<string, unknown>,
    buffers?: ArrayBuffer[]
  ): void {
    const msg: CommMsgMessage = {
      type: "comm_msg",
      payload: {
        commId,
        method,
        data,
        buffers,
      },
    };

    if (this.isWidgetReady) {
      this.frame.send(msg);
    } else {
      this.messageBuffer.push(msg);
    }
  }

  /**
   * Forward a comm_close to the iframe.
   * Called when the kernel closes a widget.
   */
  sendCommClose(commId: string): void {
    const msg: CommCloseMessage = {
      type: "comm_close",
      payload: { commId },
    };

    if (this.isWidgetReady) {
      this.frame.send(msg);
      this.sentModels.delete(commId);
    } else {
      this.messageBuffer.push(msg);
    }
  }

  /**
   * Clean up subscriptions and state.
   */
  dispose(): void {
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }
    this.messageBuffer = [];
    this.sentModels.clear();
    this.previousState.clear();
    this.isWidgetReady = false;
  }

  // --- Private Methods ---

  private handleWidgetReady(): void {
    console.log("[CommBridge] Widget ready, syncing models");
    this.isWidgetReady = true;

    // Send comm_sync with all existing models
    const models = this.store.getSnapshot();
    const modelArray: CommSyncMessage["payload"]["models"] = [];

    console.log("[CommBridge] Parent store has", models.size, "models");
    for (const [commId, model] of models) {
      console.log("[CommBridge] Syncing model:", commId, model.modelName);
      modelArray.push({
        commId,
        targetName: model.modelModule || "jupyter.widget",
        state: model.state,
        buffers: model.buffers,
      });
      this.sentModels.add(commId);
      // Store initial state for change detection
      this.previousState.set(commId, { ...model.state });
    }

    if (modelArray.length > 0) {
      const syncMsg: CommSyncMessage = {
        type: "comm_sync",
        payload: { models: modelArray },
      };
      console.log("[CommBridge] Sending comm_sync with", modelArray.length, "models");
      try {
        this.frame.send(syncMsg);
        console.log("[CommBridge] comm_sync sent successfully");
      } catch (e) {
        console.error("[CommBridge] Error sending comm_sync:", e);
      }
    } else {
      console.log("[CommBridge] No models to sync");
    }

    // Flush buffered messages
    if (this.messageBuffer.length > 0) {
      console.log("[CommBridge] Flushing", this.messageBuffer.length, "buffered messages");
    }
    for (const msg of this.messageBuffer) {
      this.frame.send(msg);
      if (msg.type === "comm_open") {
        this.sentModels.add(msg.payload.commId);
      } else if (msg.type === "comm_close") {
        this.sentModels.delete(msg.payload.commId);
      }
    }
    this.messageBuffer = [];
  }

  private handleWidgetCommMsg(payload: {
    commId: string;
    method: "update" | "custom";
    data: Record<string, unknown>;
    bufferPaths?: string[][];
    buffers?: ArrayBuffer[];
  }): void {
    const { commId, method, data, buffers } = payload;

    if (method === "update") {
      // Set flag to prevent echoing this update back to iframe
      this.isProcessingIframeUpdate = true;
      try {
        // Update parent store first (so UI stays in sync)
        this.store.updateModel(commId, data, buffers);
        // Update our tracked state
        const current = this.previousState.get(commId) ?? {};
        this.previousState.set(commId, { ...current, ...data });
        // Then forward to kernel
        this.sendUpdateToKernel(commId, data, buffers);
      } finally {
        this.isProcessingIframeUpdate = false;
      }
    } else if (method === "custom") {
      // Custom messages go directly to kernel (no store update)
      this.sendCustomToKernel(commId, data, buffers);
    }
  }

  private handleWidgetCommClose(payload: { commId: string }): void {
    const { commId } = payload;

    // Update parent store
    this.store.deleteModel(commId);
    // Forward to kernel
    this.closeCommWithKernel(commId);
    // Clean up tracking
    this.sentModels.delete(commId);
  }

  /**
   * Sync models with iframe: new models, deleted models, and state changes.
   * Called when store changes after widget_ready.
   */
  private syncModels(): void {
    const models = this.store.getSnapshot();

    for (const [commId, model] of models) {
      if (!this.sentModels.has(commId)) {
        // New model - send comm_open
        this.sendCommOpen(
          commId,
          model.modelModule || "jupyter.widget",
          model.state,
          model.buffers
        );
        // Store initial state for change detection
        this.previousState.set(commId, { ...model.state });
      } else {
        // Existing model - check for state changes
        const previous = this.previousState.get(commId);
        if (previous) {
          const changedKeys = this.getChangedKeys(previous, model.state);
          if (changedKeys.length > 0) {
            // Build delta with only changed keys
            const delta: Record<string, unknown> = {};
            for (const key of changedKeys) {
              delta[key] = model.state[key];
            }
            // Forward state update to iframe
            this.sendCommMsg(commId, "update", delta, model.buffers);
            // Update tracked state
            this.previousState.set(commId, { ...model.state });
          }
        }
      }
    }

    // Check for deleted models
    for (const commId of this.sentModels) {
      if (!models.has(commId)) {
        this.sendCommClose(commId);
        this.previousState.delete(commId);
      }
    }
  }

  /**
   * Get keys that have changed between two state objects.
   * Uses shallow comparison for performance.
   */
  private getChangedKeys(
    previous: Record<string, unknown>,
    current: Record<string, unknown>
  ): string[] {
    const changed: string[] = [];
    const allKeys = new Set([...Object.keys(previous), ...Object.keys(current)]);
    for (const key of allKeys) {
      if (previous[key] !== current[key]) {
        changed.push(key);
      }
    }
    return changed;
  }
}

/**
 * Create a comm bridge manager for an isolated frame.
 */
export function createCommBridgeManager(
  options: CommBridgeManagerOptions
): CommBridgeManager {
  return new CommBridgeManager(options);
}
