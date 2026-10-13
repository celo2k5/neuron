"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export interface Activity { id: string; topic: string; ref_id: string; data: Record<string, unknown>; created_at: string }
type Listener = (a: Activity) => void;
const listeners = new Set<Listener>();
let status: "connecting" | "live" | "down" = "connecting";
const statusListeners = new Set<() => void>();

/** Map event topics → query keys to refetch. Events are hints; queries fetch authoritative state. */
const INVALIDATE: [RegExp, (a: Activity) => unknown[][]][] = [
  [/^experiment\./, (a) => [["experiments"], ["experiment", a.ref_id], ["model"]]],
  [/^training\./, (a) => [["training", a.ref_id], ["trainings"], ["model"], ["session"]]],
  [/^model\./, () => [["models"]]],
  [/^network\./, () => [["community"], ["ledger"]]],
  [/^payment\./, () => [["payments"], ["session"], ["credits"], ["ledger"], ["token"]]],
  [/^registry\./, () => [["ledger"], ["experiment"]]],
  [/^governance\./, () => [["governance"]]],
  // a setting changed in /admin: refetch everything that reads configuration
  [/^config\./, () => [["config"], ["admin"], ["readiness"], ["governance"], ["credits"], ["session"], ["token"], ["ready"]]],
];

export function useEventStream() {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const setStatus = (s: typeof status) => { status = s; statusListeners.forEach((l) => l()); };
    const open = () => {
      es = new EventSource("/api/events");
      es.addEventListener("hello", () => { setStatus("live"); qc.invalidateQueries(); /* resync after (re)connect */ });
      es.addEventListener("activity", (ev) => {
        const a = JSON.parse((ev as MessageEvent).data) as Activity;
        for (const [re, keys] of INVALIDATE) if (re.test(a.topic)) keys(a).forEach((k) => qc.invalidateQueries({ queryKey: k }));
        listeners.forEach((l) => l(a));
      });
      es.onerror = () => { setStatus("down"); es?.close(); if (!closed) retry = setTimeout(open, 3000); };
    };
    open();
    return () => { closed = true; clearTimeout(retry); es?.close(); };
  }, [qc]);
}

export function useActivity(filter?: (a: Activity) => boolean, max = 30) {
  const [items, setItems] = useState<Activity[]>([]);
  useEffect(() => {
    const l: Listener = (a) => { if (!filter || filter(a)) setItems((x) => [a, ...x].slice(0, max)); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [filter, max]);
  return items;
}

export function useStreamStatus() {
  const [s, set] = useState(status);
  useEffect(() => { const l = () => set(status); statusListeners.add(l); return () => { statusListeners.delete(l); }; }, []);
  return s;
}
