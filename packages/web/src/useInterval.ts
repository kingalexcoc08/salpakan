import { useEffect, useRef } from "react";

/** Runs `callback` every `delayMs`, starting immediately, until unmounted or `delayMs` is null. */
export function useInterval(callback: () => void, delayMs: number | null) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (delayMs === null) return;
    savedCallback.current();
    const id = setInterval(() => savedCallback.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}
