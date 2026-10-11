import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-[700px] px-4 py-24">

      <h1 className="display mt-2 text-[72px]">No such node.</h1>
      <p className="mt-3 text-muted">That address is not part of this network. Check the link, or start from the lab.</p>
      <div className="mt-6 flex gap-4"><Link href="/lab" className="act-primary no-underline">Enter the lab</Link><Link href="/networks">Explore networks</Link></div>
    </div>
  );
}
