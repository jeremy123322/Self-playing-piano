"use client";

import { useCallback, useEffect, useState } from "react";
import type { DiagnosticsResponse } from "@/lib/diagnostics-types";

const POLL_INTERVAL_MS = 5000;

export const useDiagnosticsData = () => {
  const [data, setData] = useState<DiagnosticsResponse>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/diagnostics", { cache: "no-store" });
      if (!response.ok) throw new Error("Diagnostics request failed");
      setData((await response.json()) as DiagnosticsResponse);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Poll the diagnostics API on mount and on an interval - this hook exists specifically to
    // keep this data synced with the server, so the fetch itself belongs in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { data, loading, failed, refresh };
};
