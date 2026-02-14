import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface DenoConfigInfo {
  path: string;
  relative_path: string;
  name: string | null;
  has_imports: boolean;
  has_tasks: boolean;
}

/** Common Deno permissions with descriptions */
export const COMMON_PERMISSIONS = [
  { flag: "--allow-read", label: "Read", description: "File system read access" },
  { flag: "--allow-write", label: "Write", description: "File system write access" },
  { flag: "--allow-net", label: "Network", description: "Network access" },
  { flag: "--allow-env", label: "Env", description: "Environment variables" },
  { flag: "--allow-run", label: "Run", description: "Subprocess execution" },
  { flag: "--allow-ffi", label: "FFI", description: "Foreign function interface" },
  { flag: "--allow-sys", label: "System", description: "System information" },
] as const;

export function useDenoDependencies() {
  const [permissions, setPermissionsState] = useState<string[]>([]);
  const [denoAvailable, setDenoAvailable] = useState<boolean | null>(null);
  const [denoConfigInfo, setDenoConfigInfo] = useState<DenoConfigInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Check Deno availability and load permissions on mount
  useEffect(() => {
    const init = async () => {
      try {
        const available = await invoke<boolean>("check_deno_available");
        setDenoAvailable(available);

        const perms = await invoke<string[]>("get_deno_permissions");
        setPermissionsState(perms);

        const config = await invoke<DenoConfigInfo | null>("detect_deno_config");
        setDenoConfigInfo(config);
      } catch (e) {
        console.error("Failed to initialize Deno dependencies:", e);
      }
    };
    init();
  }, []);

  const setPermissions = useCallback(async (newPermissions: string[]) => {
    setLoading(true);
    try {
      await invoke("set_deno_permissions", { permissions: newPermissions });
      setPermissionsState(newPermissions);
    } catch (e) {
      console.error("Failed to set Deno permissions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const addPermission = useCallback(async (permission: string) => {
    if (!permission.trim() || permissions.includes(permission.trim())) {
      return;
    }
    const newPermissions = [...permissions, permission.trim()];
    await setPermissions(newPermissions);
  }, [permissions, setPermissions]);

  const removePermission = useCallback(async (permission: string) => {
    const newPermissions = permissions.filter((p) => p !== permission);
    await setPermissions(newPermissions);
  }, [permissions, setPermissions]);

  const togglePermission = useCallback(async (flag: string) => {
    if (permissions.includes(flag)) {
      await removePermission(flag);
    } else {
      await addPermission(flag);
    }
  }, [permissions, addPermission, removePermission]);

  const hasPermission = useCallback((flag: string) => {
    return permissions.includes(flag);
  }, [permissions]);

  return {
    permissions,
    denoAvailable,
    denoConfigInfo,
    loading,
    addPermission,
    removePermission,
    togglePermission,
    hasPermission,
    setPermissions,
  };
}
