import { Info, FileText, Package, ExternalLink } from "lucide-react";
import type { DenoConfigInfo } from "../hooks/useDenoDependencies";

interface DenoDependencyHeaderProps {
  denoAvailable: boolean | null;
  denoConfigInfo: DenoConfigInfo | null;
}

export function DenoDependencyHeader({
  denoAvailable,
  denoConfigInfo,
}: DenoDependencyHeaderProps) {
  return (
    <div className="border-b bg-emerald-500/5 dark:bg-emerald-500/10">
      <div className="px-3 py-3">
        {/* Deno badge */}
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Deno
          </span>
          <span className="text-xs text-muted-foreground">Dependencies</span>
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
                Using{" "}
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

        {/* No config file - explain how Deno handles deps */}
        {!denoConfigInfo && denoAvailable !== false && (
          <div className="mb-3 flex items-start gap-2 rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              No <code className="rounded bg-muted px-1">deno.json</code> found.
              Deno can import modules directly without configuration.
            </span>
          </div>
        )}

        {/* Import examples */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Import modules directly in your code:
          </div>

          {/* npm packages */}
          <div className="rounded border bg-background px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Package className="h-3 w-3" />
              <span className="font-medium">npm packages</span>
            </div>
            <code className="text-xs text-emerald-600 dark:text-emerald-400">
              import _ from "npm:lodash@4";
            </code>
          </div>

          {/* JSR (recommended) */}
          <div className="rounded border bg-background px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Package className="h-3 w-3" />
              <span className="font-medium">JSR</span>
              <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                recommended
              </span>
            </div>
            <code className="text-xs text-emerald-600 dark:text-emerald-400">
              import &#123; assert &#125; from "jsr:@std/assert";
            </code>
          </div>

          {/* URL imports */}
          <div className="rounded border bg-background px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <ExternalLink className="h-3 w-3" />
              <span className="font-medium">URL imports</span>
            </div>
            <code className="text-xs text-emerald-600 dark:text-emerald-400 break-all">
              import &#123; serve &#125; from "https://deno.land/std/http/server.ts";
            </code>
          </div>
        </div>

        {/* Tip for import maps */}
        {!denoConfigInfo && (
          <div className="mt-3 text-xs text-muted-foreground">
            <span className="font-medium">Tip:</span> Create a{" "}
            <code className="rounded bg-muted px-1">deno.json</code> with an{" "}
            <code className="rounded bg-muted px-1">"imports"</code> field to use
            shorter import specifiers.
          </div>
        )}
      </div>
    </div>
  );
}
