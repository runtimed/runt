import { useCallback, useEffect, useRef, useState } from "react";
import { useInput } from "ink";

interface UseExitHandlerOptions {
  onExit?: () => void;
  timeout?: number;
  enabled?: boolean;
}

export function useExitHandler(options: UseExitHandlerOptions = {}) {
  const { onExit, timeout = 1000, enabled = true } = options;
  const [ctrlCPressedOnce, setCtrlCPressedOnce] = useState(false);
  const ctrlCTimerRef = useRef<number | null>(null);

  const handleExit = useCallback(() => {
    if (ctrlCPressedOnce) {
      // Second Ctrl+C - exit immediately
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
      }

      // Call custom exit handler if provided
      if (onExit) {
        onExit();
      }

      Deno.exit(0);
    } else {
      // First Ctrl+C - show warning and start timer
      setCtrlCPressedOnce(true);
      ctrlCTimerRef.current = setTimeout(() => {
        setCtrlCPressedOnce(false);
        ctrlCTimerRef.current = null;
      }, timeout);
    }
  }, [ctrlCPressedOnce, onExit, timeout]);

  useInput((input, key) => {
    if (enabled && key.ctrl && (input === "c" || input === "C")) {
      handleExit();
    }
  });

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
      }
    };
  }, []);

  const exitApp = useCallback(() => {
    if (onExit) {
      onExit();
    }
    Deno.exit(1);
  }, [onExit]);

  return {
    ctrlCPressedOnce,
    handleExit,
    exitApp,
  };
}
