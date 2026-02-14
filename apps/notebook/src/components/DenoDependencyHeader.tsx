import { useState, useCallback, type KeyboardEvent } from "react";
import { X, Plus, Info, FileText, Shield, ShieldCheck, ShieldAlert } from "lucide-react";
import type { DenoConfigInfo } from "../hooks/useDenoDependencies";
import { COMMON_PERMISSIONS } from "../hooks/useDenoDependencies";

interface DenoDependencyHeaderProps {
  permissions: string[];
  denoAvailable: boolean | null;
  denoConfigInfo: DenoConfigInfo | null;
  loading: boolean;
  onTogglePermission: (flag: string) => Promise<void>;
  onAddPermission: (permission: string) => Promise<void>;
  onRemovePermission: (permission: string) => Promise<void>;
}

export function DenoDependencyHeader({
  permissions,
  denoAvailable,
  denoConfigInfo,
  loading,
  onTogglePermission,
  onAddPermission,
  onRemovePermission,
}: DenoDependencyHeaderProps) {
  const [newPermission, setNewPermission] = useState("");

  const handleAdd = useCallback(async () => {
    if (newPermission.trim()) {
      await onAddPermission(newPermission.trim());
      setNewPermission("");
    }
  }, [newPermission, onAddPermission]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd]
  );

  // Check if --allow-all is set
  const hasAllowAll = permissions.includes("--allow-all");

  // Get custom permissions (those not in COMMON_PERMISSIONS)
  const commonFlags: Set<string> = new Set(COMMON_PERMISSIONS.map((p) => p.flag));
  const customPermissions = permissions.filter(
    (p) => !commonFlags.has(p) && p !== "--allow-all"
  );

  return (
    <div className="border-b bg-emerald-500/5 dark:bg-emerald-500/10">
      <div className="px-3 py-3">
        {/* Deno badge */}
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Deno
          </span>
          <span className="text-xs text-muted-foreground">Permissions</span>
        </div>

        {/* Deno availability notice */}
        {denoAvailable === false && (
          <div className="mb-3 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <span className="font-medium">Deno not found.</span> Install it with{" "}
            <code className="rounded bg-amber-500/20 px-1">
              curl -fsSL https://deno.land/install.sh | sh
            </code>
          </div>
        )}

        {/* deno.json detected banner */}
        {denoConfigInfo && (
          <div className="mb-3 rounded bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span>
                Using config from{" "}
                <code className="rounded bg-emerald-500/20 px-1">
                  {denoConfigInfo.relative_path}
                </code>
                {denoConfigInfo.name && (
                  <span className="text-muted-foreground ml-1">
                    ({denoConfigInfo.name})
                  </span>
                )}
              </span>
            </div>
            {(denoConfigInfo.has_imports || denoConfigInfo.has_tasks) && (
              <div className="mt-1.5 flex gap-2 text-emerald-500/80">
                {denoConfigInfo.has_imports && (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5">
                    imports
                  </span>
                )}
                {denoConfigInfo.has_tasks && (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5">
                    tasks
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Permissions info */}
        <div className="mb-3 flex items-start gap-2 rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Deno runs in a sandbox by default. Grant permissions for file system,
            network, or other system access.
          </span>
        </div>

        {/* Allow all toggle */}
        <div className="mb-3">
          <button
            type="button"
            onClick={() => onTogglePermission("--allow-all")}
            disabled={loading}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
              hasAllowAll
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {hasAllowAll ? (
              <ShieldAlert className="h-3.5 w-3.5" />
            ) : (
              <Shield className="h-3.5 w-3.5" />
            )}
            <span className="font-medium">--allow-all</span>
            <span className="text-muted-foreground">
              {hasAllowAll ? "(all permissions granted)" : "(grant all permissions)"}
            </span>
          </button>
        </div>

        {/* Common permissions grid */}
        {!hasAllowAll && (
          <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {COMMON_PERMISSIONS.map(({ flag, label, description }) => {
              const isEnabled = permissions.includes(flag);
              return (
                <button
                  key={flag}
                  type="button"
                  onClick={() => onTogglePermission(flag)}
                  disabled={loading}
                  className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors ${
                    isEnabled
                      ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                  title={description}
                >
                  {isEnabled ? (
                    <ShieldCheck className="h-3 w-3" />
                  ) : (
                    <Shield className="h-3 w-3" />
                  )}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Custom permissions list */}
        {customPermissions.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {customPermissions.map((perm) => (
              <div
                key={perm}
                className="flex items-center gap-1 rounded bg-background px-2 py-1 text-xs border"
              >
                <span className="font-mono">{perm}</span>
                <button
                  type="button"
                  onClick={() => onRemovePermission(perm)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  disabled={loading}
                  title={`Remove ${perm}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add custom permission input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newPermission}
            onChange={(e) => setNewPermission(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="--allow-read=/path or --allow-net=example.com"
            className="flex-1 rounded border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={loading || !newPermission.trim()}
            className="flex items-center gap-1 rounded bg-emerald-500 px-2 py-1 text-xs text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
