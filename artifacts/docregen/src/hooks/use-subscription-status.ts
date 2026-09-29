import { useState, useEffect, useCallback } from "react";

export type SubscriptionStatus = {
  loading: boolean;
  canWrite: boolean;
  isFree: boolean;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  refetch: () => void;
};

export function useSubscriptionStatus(): SubscriptionStatus {
  const [loading, setLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [isFree, setIsFree] = useState(false);
  const [status, setStatus] = useState("unknown");
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<number | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    // Never retain a previous grant while a fresh billing decision is pending.
    setCanWrite(false);
    fetch("/regen-api/stripe/subscription-status", {
      credentials: "same-origin",
    })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          setCanWrite(false);
          return null;
        }
        return r.json();
      })
      .then((d: Record<string, unknown> | null) => {
        if (!d) return;
        setCanWrite(typeof d.canWrite === "boolean" ? d.canWrite : false);
        setIsFree(typeof d.isFree === "boolean" ? d.isFree : false);
        setStatus(typeof d.status === "string" ? d.status : "unknown");
        setCurrentPeriodEnd(typeof d.currentPeriodEnd === "number" ? d.currentPeriodEnd : null);
        setCancelAtPeriodEnd(typeof d.cancelAtPeriodEnd === "boolean" ? d.cancelAtPeriodEnd : false);
      })
      .catch(() => { setCanWrite(false); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return { loading, canWrite, isFree, status, currentPeriodEnd, cancelAtPeriodEnd, refetch: load };
}
