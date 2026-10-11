import { Suspense } from "react";
import { Gallery } from "@/components/Gallery";
export const metadata = { title: "Networks" };
export default function Page() {
  return <Suspense fallback={<div className="p-8 text-muted">loading…</div>}><Gallery /></Suspense>;
}
