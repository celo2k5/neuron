"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { spring } from "@/lib/client/motion";
import { NeuronWalletProvider } from "@/lib/client/wallet";
import { useEventStream } from "@/lib/client/events";
import { ClientApiError } from "@/lib/client/api";

function Events() { useEventStream(); return null; }

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ClientApiError && e.status < 500) && n < 2 },
    },
  }));
  return (
    <MotionConfig reducedMotion="user" transition={spring.soft}>
      <QueryClientProvider client={qc}>
        <NeuronWalletProvider>
          <Events />
          {children}
        </NeuronWalletProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}
