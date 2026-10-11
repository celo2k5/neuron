"use client";
import { motion } from "motion/react";
import { EASE } from "@/components/motion";

/** Route transition: each page settles in with a short fade and lift. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: EASE }}>
      {children}
    </motion.div>
  );
}
