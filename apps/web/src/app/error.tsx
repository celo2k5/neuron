"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[700px] px-4 py-24">
      <div className="label">§ fault</div>
      <h1 className="display mt-2 text-[44px]">THE INSTRUMENT FAULTED.</h1>
      <p className="mt-3 text-muted">{error.message || "An unexpected error occurred while rendering this page."}{error.digest ? ` (ref ${error.digest})` : ""}</p>
      <button className="act-primary mt-6" onClick={reset}>try again</button>
    </div>
  );
}
