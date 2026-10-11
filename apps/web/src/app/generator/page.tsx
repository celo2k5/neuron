import { Suspense } from "react";
import { Generator } from "@/components/Generator";
export const metadata = { title: "Model generator" };
export default function Page() {
  return <Suspense fallback={<div className="p-8 text-muted">loading…</div>}><Generator /></Suspense>;
}
