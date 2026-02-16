import { GitBranch, Zap } from "lucide-react";
import { PoolStatus } from "../hooks/usePrewarmStatus";

interface DebugBannerProps {
  branch: string;
  commit: string;
  description?: string | null;
  poolStatus?: PoolStatus | null;
}

export function DebugBanner({
  branch,
  commit,
  description,
  poolStatus,
}: DebugBannerProps) {
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
      {poolStatus && (
        <>
          <span className="text-violet-300">|</span>
          <Zap className="h-3 w-3 text-yellow-300" />
          <span className="text-violet-100">
            Pool: {poolStatus.available}/{poolStatus.target}
            {poolStatus.creating > 0 && (
              <span className="text-violet-300">
                {" "}
                (+{poolStatus.creating})
              </span>
            )}
          </span>
        </>
      )}
      <span className="ml-2 rounded bg-violet-500/50 px-1.5 py-0.5 text-[10px] font-medium uppercase">
        Dev
      </span>
    </div>
  );
}
