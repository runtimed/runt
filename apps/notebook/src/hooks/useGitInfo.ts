import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface GitInfo {
  branch: string;
  commit: string;
  description: string | null;
}

export function useGitInfo() {
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  useEffect(() => {
    invoke<GitInfo | null>("get_git_info")
      .then(setGitInfo)
      .catch((e) => {
        console.error("Failed to get git info:", e);
      });
  }, []);

  return gitInfo;
}
