import { useState, useCallback, type KeyboardEvent } from "react";
import { X, Plus, Info } from "lucide-react";

interface DependencyHeaderProps {
  dependencies: string[];
  requiresPython: string | null;
  uvAvailable: boolean | null;
  loading: boolean;
  syncedWhileRunning: boolean;
  needsKernelRestart: boolean;
  onAdd: (pkg: string) => Promise<void>;
  onRemove: (pkg: string) => Promise<void>;
}

export function DependencyHeader({
  dependencies,
  requiresPython,
  uvAvailable,
  loading,
  syncedWhileRunning,
  needsKernelRestart,
  onAdd,
  onRemove,
}: DependencyHeaderProps) {
  const [newDep, setNewDep] = useState("");

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

  return (
    <div className="border-b bg-muted/30">
      <div className="px-3 py-3">
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
                Restart kernel to use these dependencies. The current kernel
                wasn&apos;t started with dependency management.
              </span>
            </div>
          )}

          {/* UV availability notice */}
          {uvAvailable === false && (
            <div className="mb-3 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              <span className="font-medium">uv not found.</span> Install it with{" "}
              <code className="rounded bg-amber-500/20 px-1">
                curl -LsSf https://astral.sh/uv/install.sh | sh
              </code>
            </div>
          )}

          {/* Python version */}
          {requiresPython && (
            <div className="mb-2 text-xs text-muted-foreground">
              Python: <span className="font-mono">{requiresPython}</span>
            </div>
          )}

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
              No dependencies. Add packages to create an isolated environment.
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
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={loading || !newDep.trim()}
              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
        </div>
      </div>
    </div>
  );
}
