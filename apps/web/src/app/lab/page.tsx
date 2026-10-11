import { Suspense } from "react";
import { Lab } from "@/components/lab/Lab";
export const metadata = { title: "Lab" };
export default function Page() {
  return <Suspense fallback={<div className="p-8 text-muted">loading lab…</div>}><Lab /></Suspense>;
}
