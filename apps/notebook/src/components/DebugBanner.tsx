import { GitBranch, Zap } from "lucide-react";
import type { PoolStatus } from "../hooks/usePrewarmStatus";

interface DebugBannerProps {
  branch: string;
  commit: string;
  description?: string | null;
  uvPoolStatus?: PoolStatus | null;
  condaPoolStatus?: PoolStatus | null;
}

export function DebugBanner({
  branch,
  commit,
  description,
  uvPoolStatus,
  condaPoolStatus,
}: DebugBannerProps) {
  const hasPoolStatus = uvPoolStatus || condaPoolStatus;

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
      {hasPoolStatus && (
        <>
          <span className="text-violet-300">|</span>
          <Zap className="h-3 w-3 text-yellow-300" />
          <span className="text-violet-100">
            {uvPoolStatus && (
              <>
                UV: {uvPoolStatus.available}/{uvPoolStatus.target}
                {uvPoolStatus.creating > 0 && (
                  <span className="text-violet-300">
                    {" "}
                    (+{uvPoolStatus.creating})
                  </span>
                )}
              </>
            )}
            {uvPoolStatus && condaPoolStatus && " "}
            {condaPoolStatus && (
              <>
                Conda: {condaPoolStatus.available}/{condaPoolStatus.target}
                {condaPoolStatus.creating > 0 && (
                  <span className="text-violet-300">
                    {" "}
                    (+{condaPoolStatus.creating})
                  </span>
                )}
              </>
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
