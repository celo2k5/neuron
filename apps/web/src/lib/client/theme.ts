"use client";
import { useSyncExternalStore } from "react";

export const THEMES = [
  { id: "obsidian", name: "OBSIDIAN", note: "cobalt / ice" },
  { id: "bio", name: "BIO", note: "forest / mint" },
  { id: "plasma", name: "PLASMA", note: "violet / coral" },
  { id: "solar", name: "SOLAR", note: "paper / orange" },
  { id: "mono", name: "MONO", note: "black / white" },
  { id: "abyss", name: "ABYSS", note: "navy / teal" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
const KEY = "neuron.theme";
const listeners = new Set<() => void>();

export function getTheme(): ThemeId {
  if (typeof document === "undefined") return "obsidian";
  return (document.documentElement.dataset.theme as ThemeId) || "obsidian";
}
export function setTheme(t: ThemeId) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked: theme still applies for this visit */ }
  listeners.forEach((l) => l());
}
export function useTheme(): ThemeId {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, getTheme, () => "obsidian");
}

/** inline script for <head>: applies the stored theme before first paint (no flash) */
export const themeBootScript = `try{var t=localStorage.getItem("${KEY}");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export interface ThemeColors { bg: string; surface: string; fg: string; muted: string; faint: string; line: string; accent: string; accent2: string; pos: string; neg: string; node: string; glow: string; warn: string; good: string; bad: string }
export function readThemeColors(): ThemeColors {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return { bg: v("--bg"), surface: v("--surface"), fg: v("--fg"), muted: v("--muted"), faint: v("--faint"), line: v("--line"), accent: v("--accent"), accent2: v("--accent-2"), pos: v("--pos"), neg: v("--neg"), node: v("--node"), glow: v("--glow"), warn: v("--warn"), good: v("--good"), bad: v("--bad") };
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
