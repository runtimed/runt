import { GitBranch, Server } from "lucide-react";

interface DebugBannerProps {
  branch: string;
  commit: string;
  description?: string | null;
  daemonVersion?: string | null;
  socketPath?: string | null;
  isDevMode?: boolean | null;
}

export function DebugBanner({
  branch,
  commit,
  description,
  daemonVersion,
  socketPath,
  isDevMode,
}: DebugBannerProps) {
  const daemonLabel = isDevMode ? "Dev Daemon" : "System Daemon";

  return (
    <div className="flex items-center justify-center gap-2 bg-violet-600/90 px-3 py-1 text-xs text-white">
      <GitBranch className="h-3 w-3" />
      <span className="font-medium">{branch}</span>
      <span className="text-violet-200">@</span>
      <span className="font-mono text-violet-200">{commit}</span>
      {description && (
        <>
          <span className="text-violet-300">|</span>
          <span className="text-violet-100">{description}</span>
        </>
      )}
      {daemonVersion && (
        <>
          <span className="text-violet-300">|</span>
          <Server className="h-3 w-3 text-emerald-300" />
          <span className="text-violet-100">
            {daemonLabel}
            {socketPath && (
              <span
                className="ml-1 font-mono truncate max-w-[350px] inline-block align-bottom"
                title={socketPath}
              >
                {socketPath}
              </span>
            )}
            {daemonVersion && (
              <span className="ml-1 text-violet-300">
                (
                <span className="font-mono">
                  {daemonVersion.includes("+")
                    ? daemonVersion.split("+")[1]
                    : daemonVersion}
                </span>
                )
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}
