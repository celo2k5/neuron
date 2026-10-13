"use client";
import { AnimatePresence, motion } from "motion/react";
import { useConfig } from "@/lib/client/wallet";

/** Site-wide notice set from /admin; appears and disappears for every visitor as soon as it changes. */
export function SiteBanner() {
  const { data } = useConfig();
  const text = data?.banner;
  return (
    <AnimatePresence initial={false}>
      {text && (
        <motion.div key="banner" role="status" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden border-b border-accent/25 bg-accent/[0.08] text-[13px]">
          <div className="mx-auto flex max-w-[1440px] items-center gap-2.5 px-5 py-2 sm:px-8">
            <span className="dot text-accent-2" aria-hidden />
            <span className="text-fg/90">{text}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
