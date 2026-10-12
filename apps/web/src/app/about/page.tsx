import Link from "next/link";
import { ENGINE_VERSION, LIMITS, TOLERANCE, TRAIN_LIMITS, PRNG_VERSION } from "@neuron/engine";
export const metadata = { title: "About" };

const S = ({ id, n, title, children }: { id: string; n: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="grid gap-6 border-t border-line py-14 lg:grid-cols-[300px_minmax(0,1fr)]">
    <div><div className="font-serif-d text-[15px] text-muted">{n}</div><h2 className="display mt-1 text-[32px]">{title}</h2></div>
    <div className="max-w-[68ch] space-y-4 text-[15.5px] leading-[1.75] text-muted [&_b]:text-fg [&_code]:text-accent-2">{children}</div>
  </section>
);

export default function About() {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pt-14 sm:px-8">
      <h1 className="display mt-2 text-[clamp(48px,6vw,92px)]">One token.<br />Infinite connections.</h1>
      <p className="mt-6 max-w-[62ch] text-[17px] text-muted">A laboratory for neural computation you can see and check. It generates models from seeds, runs them, trains small ones, and records signed hashes of what happened in a tamper-evident registry. This page states what the system does and, as importantly, what it does not claim.</p>

      <S id="math" n="01" title="Model math">
        <p>Each layer computes <code>z = W·a + b</code> (a dense matrix–vector product; sparse layers store pruned weights as exact zeros under a mask), adds an identity skip <code>+ a[l−2]</code> on residual layers, then applies its activation: ReLU, leaky ReLU (0.01), sigmoid, tanh, linear, or a numerically stable softmax on the output layer.</p>
        <p>Training is mini-batch backpropagation: cross-entropy with softmax outputs, mean squared error otherwise. Optimisers: SGD with optional momentum, and Adam (β₁ 0.9, β₂ 0.999, ε 1e−8). Gradients are checked against central finite differences in the test suite.</p>
      </S>
      <S id="encoding" n="02" title="Deterministic encoding">
        <p>Configs are canonically encoded (sorted keys, ECMAScript shortest round-trip numbers, −0 → 0, NaN/∞ rejected) and hashed with SHA-256. The PRNG <code>{PRNG_VERSION}</code> is sfc32 seeded from SHA-256 of the canonical config; normals use the Irwin–Hall sum of 12 uniforms so generation uses only exact integer and float operations.</p>
        <p><b>config hash</b> = H(engine, prng, config). <b>artifact hash</b> = H(schema, engine, config hash, every layer&apos;s W, b, mask, skip). <b>result hash</b> = H(engine, artifact hash, config hash, input, output). Engine: <code>{ENGINE_VERSION}</code>. Identical seed + config + engine version reproduce the same model hash.</p>
      </S>
      <S id="repro" n="03" title="Reproducibility">
        <p>Generation is bit-exact across conforming JavaScript engines. Inference uses <code>Math.exp</code> and <code>Math.tanh</code>, which the language does not require to be correctly rounded, so different engines or hardware may differ in the last bits. The reproduce action reports <b>exact</b>, <b>within tolerance</b> (|Δ| ≤ {TOLERANCE.abs} or relative ≤ {TOLERANCE.rel}) or <b>mismatch</b>.</p>
      </S>
      <S id="verification" n="04" title="What verification means">
        <p>Recording an experiment appends its result, artifact and metadata hashes to the NEURON registry: an append-only log where every entry contains the hash of the entry before it and is signed with the server&apos;s ed25519 registry key. The database also refuses any update or delete of an entry.</p>
        <p><b>Verified</b> means the entry&apos;s hashes equal hashes recomputed from the stored experiment, the entry hash recomputes, the signature checks against the published key, and the entry links to its predecessor. It shows what was recorded, for which wallet and when, and that it hasn&apos;t been edited since. It does <b>not</b> prove the arithmetic was correct; anyone can re-run the pinned version to check that.</p>
      </S>
      <S id="limits" n="05" title="Limits">
        <p>Models: ≤ {LIMITS.maxLayers} layers, ≤ {LIMITS.maxWidth} neurons per layer, ≤ {LIMITS.maxNeurons} neurons, ≤ {LIMITS.maxParams} potential parameters, inputs within ±{LIMITS.maxAbsInput}. Training: ≤ {TRAIN_LIMITS.maxEpochs} epochs, ≤ {TRAIN_LIMITS.maxDataset} samples, batch ≤ {TRAIN_LIMITS.maxBatch}, in an isolated worker thread with a 256 MB heap cap and a wall-clock limit.</p>
        <p>Generated models are not trained and carry no learned behaviour. Training on toy datasets improves only the measured loss and accuracy shown, on those datasets.</p>
      </S>
      <S id="trust" n="06" title="Trust assumptions">
        <p>The API operator can see experiment inputs and holds the registry signing key. Because the log is hash-chained and its head is shown publicly on the Ledger, a rewrite of history is detectable by anyone who saved an earlier head or entry. Governance can only change whitelisted community-network parameters. Wallet sign-in uses single-use, domain-bound challenges; NEURON never asks for private keys and never moves funds.</p>
        <p>Full details: <code>docs/SECURITY.md</code> and <Link href="/ops">operations status</Link>.</p>
      </S>
    </div>
  );
}
