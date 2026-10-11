"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type PublicConfig } from "./api";

/**
 * One wallet interface for the app, backed by either
 *  - a Wallet Standard wallet (Phantom, Solflare, Backpack… detected by @solana/wallet-adapter-react), or
 *  - a DEV burner keypair kept in this browser — offered on localnet only, clearly labelled.
 */
export interface NeuronWallet {
  address: string | null;
  kind: "standard" | "dev" | null;
  label: string | null;
  available: { name: string; icon: string; ready: boolean }[];
  connecting: boolean;
  connect(name: string): Promise<void>;
  disconnect(): Promise<void>;
  signMessage(msg: string): Promise<string>;
  /** signs and sends, returns signature */
  sendTransaction(base64: string): Promise<string>;
  connection: Connection | null;
}

const Ctx = createContext<NeuronWallet | null>(null);
const DEV_KEY = "neuron.devwallet.v1";
export const DEV_WALLET = "NEURON DEV WALLET";

function loadDev(): Keypair {
  try {
    const raw = localStorage.getItem(DEV_KEY);
    if (raw) return Keypair.fromSecretKey(bs58.decode(raw));
  } catch { /* fall through */ }
  const k = Keypair.generate();
  try { localStorage.setItem(DEV_KEY, bs58.encode(k.secretKey)); } catch { /* ephemeral */ }
  return k;
}

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => api<PublicConfig>("/api/config"), staleTime: 60_000 });
}

function Inner({ children, cfg }: { children: ReactNode; cfg: PublicConfig | undefined }) {
  const std = useWallet();
  const [dev, setDev] = useState<Keypair | null>(null);
  const [connecting, setConnecting] = useState(false);
  const connection = useMemo(() => (cfg ? new Connection(cfg.rpc, "confirmed") : null), [cfg]);
  const isLocal = cfg?.cluster === "localnet";

  useEffect(() => {
    try { if (isLocal && localStorage.getItem("neuron.wallet.kind") === "dev") setDev(loadDev()); } catch { /* ignore */ }
  }, [isLocal]);

  const available = useMemo(() => {
    const list: { name: string; icon: string; ready: boolean }[] = std.wallets.map((w) => ({ name: w.adapter.name as string, icon: w.adapter.icon, ready: w.readyState === "Installed" || w.readyState === "Loadable" }));
    if (isLocal) list.push({ name: DEV_WALLET, icon: "", ready: true });
    return list;
  }, [std.wallets, isLocal]);

  const connect = useCallback(async (name: string) => {
    setConnecting(true);
    try {
      if (name === DEV_WALLET) {
        if (!isLocal) throw new Error("The dev wallet only exists on localnet.");
        setDev(loadDev());
        try { localStorage.setItem("neuron.wallet.kind", "dev"); } catch { /* ignore */ }
        return;
      }
      setDev(null);
      try { localStorage.setItem("neuron.wallet.kind", "standard"); } catch { /* ignore */ }
      std.select(name as never);
      await new Promise((r) => setTimeout(r, 30));
      await std.connect().catch(() => {});
    } finally { setConnecting(false); }
  }, [isLocal, std]);

  const value: NeuronWallet = {
    address: dev ? dev.publicKey.toBase58() : std.publicKey?.toBase58() ?? null,
    kind: dev ? "dev" : std.publicKey ? "standard" : null,
    label: dev ? DEV_WALLET : std.wallet?.adapter.name ?? null,
    available,
    connecting: connecting || std.connecting,
    connect,
    async disconnect() {
      if (dev) { setDev(null); try { localStorage.removeItem("neuron.wallet.kind"); } catch { /* ignore */ } return; }
      await std.disconnect();
    },
    async signMessage(msg) {
      const bytes = new TextEncoder().encode(msg);
      if (dev) return bs58.encode(nacl.sign.detached(bytes, dev.secretKey));
      if (!std.signMessage) throw new Error("This wallet cannot sign messages.");
      return bs58.encode(await std.signMessage(bytes));
    },
    async sendTransaction(b64) {
      if (!connection) throw new Error("No RPC connection configured.");
      const tx = Transaction.from(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      if (dev) {
        tx.partialSign(dev);
        return connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
      }
      return std.sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
    },
    connection,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function NeuronWalletProvider({ children }: { children: ReactNode }) {
  const { data: cfg } = useConfig();
  return (
    <ConnectionProvider endpoint={cfg?.rpc ?? "http://127.0.0.1:8899"}>
      <WalletProvider wallets={[]} autoConnect>
        <Inner cfg={cfg}>{children}</Inner>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function useNeuronWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNeuronWallet outside provider");
  return c;
}

export interface SessionInfo { session: { wallet: string; userId: string; cluster: string } | null; credits?: { available: number; reserved: number; consumed: number; refunded: number } }
export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: () => api<SessionInfo>("/api/auth/session"), staleTime: 15_000 });
}

/** challenge → wallet signature → session cookie */
export function useSignIn() {
  const w = useNeuronWallet();
  const qc = useQueryClient();
  return useCallback(async () => {
    if (!w.address) throw new Error("Connect a wallet first.");
    const ch = await api<{ message: string }>("/api/auth/challenge", { method: "POST", json: { intent: "sign-in", wallet: w.address } });
    const signature = await w.signMessage(ch.message);
    await api("/api/auth/session", { method: "POST", json: { message: ch.message, signature } });
    await qc.invalidateQueries();
  }, [w, qc]);
}

/** sign a server-issued, action-bound challenge (vote / register / update) */
export function useSignedAction() {
  const w = useNeuronWallet();
  return useCallback(async (req: Record<string, unknown>) => {
    if (!w.address) throw new Error("Connect a wallet first.");
    const ch = await api<{ message: string }>("/api/auth/challenge", { method: "POST", json: { ...req, wallet: w.address } });
    return { message: ch.message, signature: await w.signMessage(ch.message) };
  }, [w]);
}
