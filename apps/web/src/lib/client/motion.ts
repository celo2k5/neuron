/**
 * Motion tokens (one rhythm for the whole app).
 *  - springs for anything that responds to a person (interruptible, natural deceleration)
 *  - exits run at ~60% of the entrance and accelerate out
 *  - only transform / opacity / filter are animated
 */
import type { Transition } from "motion/react";

export const spring = {
  /** controls, pills, toggles: quick and firm */
  ui: { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } satisfies Transition,
  /** panels, dialogs, sections arriving */
  soft: { type: "spring", stiffness: 170, damping: 24, mass: 0.9 } satisfies Transition,
  /** data values settling (bars, gauges) */
  data: { type: "spring", stiffness: 90, damping: 18 } satisfies Transition,
};

export const exit: Transition = { duration: 0.16, ease: [0.4, 0, 1, 1] };
export const STAGGER = 0.045;
