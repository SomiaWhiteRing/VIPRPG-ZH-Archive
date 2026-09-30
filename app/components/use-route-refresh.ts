import { useEffect, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";

// A fetcher loads only the current leaf route, preserving parent/session data.
export function useRouteRefresh<T>(initial: T) {
  const location = useLocation();
  const fetcher = useFetcher<T>({ key: `route-refresh:${location.key}` });
  const source = useRef(initial);
  const [snapshot, setSnapshot] = useState({ source: initial, data: initial });
  useEffect(() => {
    if (fetcher.data !== undefined && source.current === initial)
      setSnapshot({ source: initial, data: fetcher.data as T });
  }, [fetcher.data, initial]);
  return {
    data: snapshot.source === initial ? snapshot.data : initial,
    refreshing: fetcher.state !== "idle",
    refresh: async () => {
      source.current = initial;
      await fetcher.load(location.pathname + location.search);
    },
  };
}
