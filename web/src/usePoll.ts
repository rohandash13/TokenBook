// OWNER: C
import { useCallback, useEffect, useState } from 'react';

export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await fn());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
    if (!ms) return;
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [reload, ms]);

  return { data, error, reload };
}
