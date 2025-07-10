/**
 * TTY Status Display for PyRunt
 *
 * Provides interactive status updates when running in a TTY environment.
 * Shows startup progress, execution status, and system information.
 */

export interface StatusUpdate {
  phase: "startup" | "ready" | "executing" | "idle" | "error";
  message: string;
  progress?: number | undefined; // 0-100
  details?: string | undefined;
}

export class TTYDisplay {
  private isEnabled: boolean;
  private currentStatus: StatusUpdate;
  private startTime: number;
  private lastUpdateTime: number;
  private statusInterval: number | undefined;

  constructor() {
    this.isEnabled = this.shouldEnable();
    this.currentStatus = {
      phase: "startup",
      message: "Initializing...",
      progress: 0,
    };
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
  }

  private shouldEnable(): boolean {
    // Check if we're in a TTY environment
    try {
      return Deno.stdout.isTerminal();
    } catch {
      return false;
    }
  }

  start(): void {
    if (!this.isEnabled) return;

    // Clear screen and hide cursor
    this.write("\x1b[?25l"); // Hide cursor
    this.write("\x1b[2J"); // Clear screen
    this.write("\x1b[H"); // Move cursor to top

    this.render();

    // Update display every 100ms
    this.statusInterval = setInterval(() => {
      this.render();
    }, 100);
  }

  stop(): void {
    if (!this.isEnabled) return;

    if (this.statusInterval !== undefined) {
      clearInterval(this.statusInterval);
      this.statusInterval = undefined;
    }

    // Show cursor and move to bottom
    this.write("\x1b[?25h"); // Show cursor
    this.write("\n");
  }

  update(status: StatusUpdate): void {
    if (!this.isEnabled) return;

    this.currentStatus = status;
    this.lastUpdateTime = Date.now();
  }

  private render(): void {
    if (!this.isEnabled) return;

    const now = Date.now();
    const elapsed = Math.floor((now - this.startTime) / 1000);
    const timeSinceUpdate = Math.floor((now - this.lastUpdateTime) / 1000);

    // Move cursor to top and clear screen
    this.write("\x1b[H");
    this.write("\x1b[2J");

    // Header
    this.write("\x1b[1;36m"); // Bold cyan
    this.write("🐍 PyRunt - Python Runtime Agent\n");
    this.write("\x1b[0m"); // Reset

    this.write("\n");

    // Status line
    const statusColor = this.getStatusColor(this.currentStatus.phase);
    const statusIcon = this.getStatusIcon(this.currentStatus.phase);

    this.write(
      `${statusColor}${statusIcon} ${this.currentStatus.message}\x1b[0m\n`,
    );

    // Progress bar if available
    if (this.currentStatus.progress !== undefined) {
      this.renderProgressBar(this.currentStatus.progress);
    }

    // Details
    if (this.currentStatus.details) {
      this.write(`\n\x1b[2m${this.currentStatus.details}\x1b[0m\n`);
    }

    // Runtime info
    this.write("\n");
    this.write("\x1b[2m"); // Dim
    this.write(`Runtime: ${this.formatDuration(elapsed)}`);

    if (
      this.currentStatus.phase === "ready" ||
      this.currentStatus.phase === "idle"
    ) {
      this.write(" | Status: Ready");
    } else if (this.currentStatus.phase === "executing") {
      this.write(" | Status: Executing");
    }

    this.write("\x1b[0m\n"); // Reset

    // Footer
    this.write("\n");
    this.write("\x1b[2mPress Ctrl+C to stop\x1b[0m\n");
  }

  private renderProgressBar(progress: number): void {
    const width = 40;
    const filled = Math.floor((progress / 100) * width);
    const empty = width - filled;

    this.write("\n");
    this.write("\x1b[32m"); // Green
    this.write("█".repeat(filled));
    this.write("\x1b[2m"); // Dim
    this.write("░".repeat(empty));
    this.write("\x1b[0m"); // Reset
    this.write(` ${progress.toFixed(0)}%\n`);
  }

  private getStatusColor(phase: StatusUpdate["phase"]): string {
    switch (phase) {
      case "startup":
        return "\x1b[33m"; // Yellow
      case "ready":
        return "\x1b[32m"; // Green
      case "executing":
        return "\x1b[34m"; // Blue
      case "idle":
        return "\x1b[32m"; // Green
      case "error":
        return "\x1b[31m"; // Red
      default:
        return "\x1b[37m"; // White
    }
  }

  private getStatusIcon(phase: StatusUpdate["phase"]): string {
    switch (phase) {
      case "startup":
        return "⏳";
      case "ready":
        return "✅";
      case "executing":
        return "🔄";
      case "idle":
        return "💤";
      case "error":
        return "❌";
      default:
        return "•";
    }
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }

  private write(text: string): void {
    if (!this.isEnabled) return;

    try {
      const encoder = new TextEncoder();
      Deno.stdout.writeSync(encoder.encode(text));
    } catch {
      // Ignore write errors
    }
  }

  // Convenience methods for common status updates
  setStartupPhase(message: string, progress?: number): void {
    const update: StatusUpdate = {
      phase: "startup",
      message,
      ...(progress !== undefined && { progress }),
      ...(progress !== undefined && { details: `Loading... ${progress}%` }),
    };
    this.update(update);
  }

  setReady(): void {
    this.update({
      phase: "ready",
      message: "Ready - Waiting for cells to execute",
      details: "Connect from your notebook to start executing code",
    });
  }

  setExecuting(cellType: string, cellId?: string): void {
    const update: StatusUpdate = {
      phase: "executing",
      message: `Executing ${cellType} cell`,
      ...(cellId && { details: `Cell ID: ${cellId}` }),
    };
    this.update(update);
  }

  setIdle(): void {
    this.update({
      phase: "idle",
      message: "Idle - Ready for next execution",
    });
  }

  setError(message: string, details?: string): void {
    const update: StatusUpdate = {
      phase: "error",
      message,
      ...(details && { details }),
    };
    this.update(update);
  }

  // Log method that respects TTY display
  log(message: string): void {
    if (!this.isEnabled) {
      console.log(message);
      return;
    }

    // Temporarily clear status display, show log, then restore
    this.write("\x1b[s"); // Save cursor position
    this.write("\x1b[2J"); // Clear screen
    this.write("\x1b[H"); // Move to top

    console.log(message);

    this.write("\x1b[u"); // Restore cursor position
    this.render();
  }
}

// Global instance
let globalDisplay: TTYDisplay | undefined;

export function getTTYDisplay(): TTYDisplay {
  if (!globalDisplay) {
    globalDisplay = new TTYDisplay();
  }
  return globalDisplay;
}

export function initializeTTYDisplay(): TTYDisplay {
  const display = getTTYDisplay();
  display.start();

  // Clean up on exit
  const cleanup = () => {
    display.stop();
    Deno.exit(0);
  };

  // Handle various exit signals
  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  // Handle unhandled promise rejections
  addEventListener("unhandledrejection", () => {
    display.stop();
  });

  return display;
}
