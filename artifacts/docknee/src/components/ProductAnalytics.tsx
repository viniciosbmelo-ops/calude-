/**
 * ProductAnalytics — mounts inside the Wouter router to track sessions and
 * page views. Records Web Vitals and privacy-safe client error categories.
 *
 * Privacy: pathname only, allowlisted UTMs from first landing URL, opaque UUID
 * session. No patient IDs, query params, form values, error text, or UA strings.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  getOrCreateSessionId,
  sanitisePath,
  extractUtms,
  categoriseError,
  sessionStart,
  sessionHeartbeat,
  sessionEnd,
  recordPageView,
  recordNavigationClick,
  recordVital,
  recordClientError,
  attachNavigationClickListener,
} from "@/lib/analytics";

// Heartbeat interval: 2 minutes
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

// Web Vitals metric names allowed by the backend
const ALLOWED_VITALS = new Set(["LCP", "CLS", "INP", "FCP", "TTFB", "FID"]);

type VitalRating = "good" | "needs-improvement" | "poor";

interface VitalEntry {
  name: string;
  value: number;
  rating?: VitalRating;
}

/**
 * Lazily registers Web Vitals observers using the native PerformanceObserver API.
 * We do NOT import the `web-vitals` package — we use the native APIs to keep the
 * bundle small and avoid the package dependency. All reported metrics pass through
 * the backend allowlist anyway.
 */
function observeWebVitals(onVital: (entry: VitalEntry) => void): () => void {
  const cleanups: (() => void)[] = [];

  // Helper to classify a value into a rating
  function rate(name: string, value: number): VitalRating {
    if (name === "LCP") return value <= 2500 ? "good" : value <= 4000 ? "needs-improvement" : "poor";
    if (name === "CLS") return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
    if (name === "INP") return value <= 200 ? "good" : value <= 500 ? "needs-improvement" : "poor";
    if (name === "FCP") return value <= 1800 ? "good" : value <= 3000 ? "needs-improvement" : "poor";
    if (name === "TTFB") return value <= 800 ? "good" : value <= 1800 ? "needs-improvement" : "poor";
    return "good";
  }

  try {
    if (typeof PerformanceObserver === "undefined") return () => {};

    // LCP
    if (PerformanceObserver.supportedEntryTypes?.includes("largest-contentful-paint")) {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
        if (last) onVital({ name: "LCP", value: last.startTime, rating: rate("LCP", last.startTime) });
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
      cleanups.push(() => lcpObs.disconnect());
    }

    // CLS
    if (PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) {
      let clsValue = 0;
      let clsSessionValue = 0;
      let clsSessionEntries: PerformanceEntry[] = [];
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
          if (!e.hadRecentInput) {
            const firstSessionEntry = clsSessionEntries[0] as (PerformanceEntry & { startTime: number }) | undefined;
            const lastSessionEntry = clsSessionEntries[clsSessionEntries.length - 1] as (PerformanceEntry & { startTime: number }) | undefined;
            if (
              clsSessionEntries.length === 0 ||
              (firstSessionEntry && e.startTime - firstSessionEntry.startTime < 5000 &&
               lastSessionEntry && e.startTime - lastSessionEntry.startTime < 1000)
            ) {
              clsSessionValue += e.value;
              clsSessionEntries.push(entry);
            } else {
              clsSessionValue = e.value;
              clsSessionEntries = [entry];
            }
            if (clsSessionValue > clsValue) {
              clsValue = clsSessionValue;
              onVital({ name: "CLS", value: clsValue, rating: rate("CLS", clsValue) });
            }
          }
        }
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
      cleanups.push(() => clsObs.disconnect());
    }

    // INP (Interaction to Next Paint)
    if (PerformanceObserver.supportedEntryTypes?.includes("event")) {
      let maxInp = 0;
      const inpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { duration: number };
          if (e.duration > maxInp) {
            maxInp = e.duration;
            onVital({ name: "INP", value: maxInp, rating: rate("INP", maxInp) });
          }
        }
      });
      inpObs.observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
      cleanups.push(() => inpObs.disconnect());
    }
  } catch {
    // PerformanceObserver unavailable or permissions policy blocked — ignore
  }

  return () => cleanups.forEach(c => c());
}

export function ProductAnalytics() {
  const [location] = useLocation();
  const { user } = useAuth();
  const sessionIdRef = useRef<string>("");
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  const isAuthenticatedPhysician = Boolean(user && !user.isAdmin);

  // Initialise session once on mount
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const sid = getOrCreateSessionId();
    sessionIdRef.current = sid;

    // Extract UTMs from the first landing URL (only on session start)
    const utms = extractUtms(window.location.href);

    sessionStart(sid, utms);

    // Heartbeat
    heartbeatRef.current = setInterval(() => {
      sessionHeartbeat(sessionIdRef.current);
    }, HEARTBEAT_INTERVAL_MS);

    // End session on page unload
    const handleUnload = () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      sessionEnd(sessionIdRef.current);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") handleUnload();
    };
    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handleUnload);

    // Web Vitals
    const disconnectVitals = observeWebVitals(({ name, value, rating }) => {
      if (!ALLOWED_VITALS.has(name)) return;
      recordVital(sessionIdRef.current, name, value, rating, sanitisePath());
    });

    // Global error handler — sends only error category, no message or stack
    const handleError = (event: ErrorEvent) => {
      const category = categoriseError(event.error);
      recordClientError(sessionIdRef.current, category, sanitisePath());
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const category = categoriseError(event.reason);
      recordClientError(sessionIdRef.current, category, sanitisePath());
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
      disconnectVitals();
    };
  }, []);

  // Record page_view on every route change (pathname only, no query/hash)
  const prevPathRef = useRef<string>("");
  useEffect(() => {
    const path = sanitisePath(location);
    if (path === prevPathRef.current) return;
    prevPathRef.current = path;
    if (sessionIdRef.current) {
      recordPageView(sessionIdRef.current, path);
    }
  }, [location]);

  // Capture actual in-app anchor clicks only for authenticated physicians.
  // Admin, public, and independent-role sessions have no listener at all.
  useEffect(() => {
    if (!isAuthenticatedPhysician) return;
    return attachNavigationClickListener((destinationPath) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) recordNavigationClick(sessionId, destinationPath);
    });
  }, [isAuthenticatedPhysician]);

  return null;
}
