import { useState, useCallback, type KeyboardEvent } from "react";
import { X, Plus, Info } from "lucide-react";

interface CondaDependencyHeaderProps {
  dependencies: string[];
  channels: string[];
  python: string | null;
  loading: boolean;
  syncedWhileRunning: boolean;
  needsKernelRestart: boolean;
  onAdd: (pkg: string) => Promise<void>;
  onRemove: (pkg: string) => Promise<void>;
  onSetChannels: (channels: string[]) => Promise<void>;
  onSetPython: (python: string | null) => Promise<void>;
}

export function CondaDependencyHeader({
  dependencies,
  channels,
  python,
  loading,
  syncedWhileRunning,
  needsKernelRestart,
  onAdd,
  onRemove,
  onSetChannels,
  onSetPython,
}: CondaDependencyHeaderProps) {
  const [newDep, setNewDep] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [showChannelInput, setShowChannelInput] = useState(false);

  const handleAdd = useCallback(async () => {
    if (newDep.trim()) {
      await onAdd(newDep.trim());
      setNewDep("");
    }
  }, [newDep, onAdd]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd]
  );

  const handleAddChannel = useCallback(async () => {
    if (newChannel.trim()) {
      const updated = [...channels, newChannel.trim()];
      await onSetChannels(updated);
      setNewChannel("");
      setShowChannelInput(false);
    }
  }, [newChannel, channels, onSetChannels]);

  const handleRemoveChannel = useCallback(
    async (channel: string) => {
      const updated = channels.filter((c) => c !== channel);
      await onSetChannels(updated);
    },
    [channels, onSetChannels]
  );

  const handlePythonChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.trim();
      await onSetPython(value || null);
    },
    [onSetPython]
  );

  // Default channels if none specified
  const displayChannels = channels.length > 0 ? channels : ["conda-forge"];

  return (
    <div className="border-b bg-emerald-50/50 dark:bg-emerald-950/20">
      <div className="px-3 py-3">
        {/* Conda badge */}
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            conda
          </span>
        </div>

        {/* Sync notice */}
        {syncedWhileRunning && (
          <div className="mb-3 flex items-start gap-2 rounded bg-blue-500/10 px-2 py-1.5 text-xs text-blue-700 dark:text-blue-400">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Dependencies synced to environment. New packages can be imported
              now. Restart kernel if you updated existing packages.
            </span>
          </div>
        )}

        {/* Kernel restart needed notice */}
        {needsKernelRestart && (
          <div className="mb-3 flex items-start gap-2 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Restart kernel to use these dependencies. Conda environments
              require a kernel restart after changes.
            </span>
          </div>
        )}

        {/* Channels */}
        <div className="mb-2">
          <div className="mb-1 text-xs text-muted-foreground">Channels:</div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {displayChannels.map((channel) => (
              <div
                key={channel}
                className="flex items-center gap-1 rounded bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs border border-emerald-200 dark:border-emerald-800"
              >
                <span className="font-mono">{channel}</span>
                {channels.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveChannel(channel)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    disabled={loading}
                    title={`Remove ${channel}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            {showChannelInput ? (
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddChannel();
                    } else if (e.key === "Escape") {
                      setShowChannelInput(false);
                      setNewChannel("");
                    }
                  }}
                  placeholder="channel name"
                  className="w-32 rounded border bg-background px-1.5 py-0.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                  disabled={loading}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={handleAddChannel}
                  disabled={loading || !newChannel.trim()}
                  className="rounded bg-emerald-500 px-1.5 py-0.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowChannelInput(true)}
                className="flex items-center gap-0.5 rounded bg-background px-1.5 py-0.5 text-xs border hover:bg-muted transition-colors"
                disabled={loading}
              >
                <Plus className="h-3 w-3" />
                channel
              </button>
            )}
          </div>
        </div>

        {/* Python version */}
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Python:</span>
          <input
            type="text"
            value={python ?? ""}
            onChange={handlePythonChange}
            placeholder="3.11"
            className="w-20 rounded border bg-background px-1.5 py-0.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Dependencies list */}
        {dependencies.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {dependencies.map((dep) => (
              <div
                key={dep}
                className="flex items-center gap-1 rounded bg-background px-2 py-1 text-xs border"
              >
                <span className="font-mono">{dep}</span>
                <button
                  type="button"
                  onClick={() => onRemove(dep)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  disabled={loading}
                  title={`Remove ${dep}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-3 text-xs text-muted-foreground">
            No dependencies. Add conda packages to create an isolated environment.
          </div>
        )}

        {/* Add dependency input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newDep}
            onChange={(e) => setNewDep(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="package or package>=version"
            className="flex-1 rounded border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={loading || !newDep.trim()}
            className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
