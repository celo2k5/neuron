"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Model } from "@neuron/engine";
import type { Scene3D, Scene3DOptions } from "@/graph/scene3d";
import { readThemeColors, useTheme } from "@/lib/client/theme";

export interface Specimen3DHandle { play(a: number[][]): void }

/** React shell for the WebGL renderer. three.js is loaded lazily so it never blocks first paint. */
export const Specimen3D = forwardRef<Specimen3DHandle, { model: Model | null; activations?: number[][] | null; className?: string; ariaLabel?: string } & Scene3DOptions>(
  function Specimen3D({ model, activations, className = "", ariaLabel, ...opts }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const scene = useRef<Scene3D | null>(null);
    const theme = useTheme();
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const optsRef = useRef(opts);

    useEffect(() => {
      let dead = false;
      import("@/graph/scene3d").then(({ Scene3D }) => {
        if (dead || !host.current) return;
        try { scene.current = new Scene3D(host.current, readThemeColors(), optsRef.current); setReady(true); }
        catch { setFailed(true); }
      });
      return () => { dead = true; scene.current?.destroy(); scene.current = null; };
    }, []);
    useEffect(() => { if (ready && model) scene.current?.setModel(model); }, [ready, model]);
    useEffect(() => { if (ready && model && activations) scene.current?.play(activations); }, [ready, model, activations]);
    useEffect(() => { if (ready) requestAnimationFrame(() => scene.current?.setColors(readThemeColors())); }, [ready, theme]);
    useImperativeHandle(ref, () => ({ play: (a) => scene.current?.play(a) }), []);

    return (
      <div ref={host} role="img" aria-label={ariaLabel ?? "Three-dimensional view of the network"} className={`overflow-hidden ${/\babsolute\b/.test(className) ? "" : "relative "}${className}`}>
        <div className={`pointer-events-none absolute inset-0 transition-opacity duration-1000 ${ready ? "opacity-0" : "opacity-100"}`} aria-hidden>
          <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl" />
        </div>
        {failed && <p className="absolute inset-0 flex items-center justify-center text-muted">WebGL is unavailable in this browser.</p>}
      </div>
    );
  },
);
