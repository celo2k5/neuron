# Model math and deterministic encoding

Engine version `neuron-engine/1.0.0`, PRNG `neuron-prng/1`, model schema `neuron.model/1`.

## Canonical encoding
- Objects: keys sorted by UTF-16 code units, no whitespace. `undefined` members omitted.
- Arrays in order; typed arrays encoded as arrays; `undefined` items rejected.
- Numbers: ECMAScript `Number::toString` (shortest round-trip). `-0 → 0`. `NaN`, `±Infinity` rejected.
- Hash: SHA-256 over the UTF-8 bytes, lowercase hex.

## PRNG
sfc32 seeded with the first 16 bytes of `SHA-256("neuron-prng/1|" + label)`, 15 warm-up draws. Sub-streams are `fork(label)` → new label `parent/label`. Normals are Irwin–Hall (sum of 12 uniforms − 6): only exact operations, so generation is bit-identical across conforming JS engines.

## Generation
Label `model|canonical(config)`. Per layer `l`: mask stream `mask/l` (sparse only; Bernoulli(density), then every output keeps ≥1 input and every input ≥1 output), weight stream `weights/l`, bias stream `bias/l` (N(0, 0.05²)).
Init std: xavier `√(2/(in+out))`, he `√(2/in_eff)`, normal `0.5`, uniform limit `√(6/(in+out))`, with `in_eff = round(in·density)` for sparse layers.
Residual: hidden layers `l = 3, 5, 7…` get `+ a[l−2]` (identity, no parameters); requires ≥3 equal-width hidden layers.

## Hashes
- `configHash = H({engine, prng, config})`
- `artifactHash = H({schema, engine, configHash, layers:[{in,out,act,W,b,mask?,res?}]})` (mask as a `0/1` string)
- `resultHash = H({engine, artifactHash, configHash, input, output})` — elapsed time excluded
- `metadataHash = H({experiment, model, version, inputSource, inputSeed, networkVersion, engine})`
- Model id = `"M-" + configHash[0:12]`. Training produces new versions; the id is stable.

## Inference
`z = W·a + b (+ a[l−2])`, `a = f(z)`; softmax is max-shifted. Every z and a is checked finite and `|x| ≤ 1e12`; inputs must be finite and `|x| ≤ 1e6`.

## Floating point
Generation is exact. Inference/training call `Math.exp`/`Math.tanh`, which JS does not require to be correctly rounded, so engines/hardware may differ in the last ulp. Reproduction compares with `abs ≤ 1e−12 or rel ≤ 1e−9` and reports `exact | within_tolerance | mismatch`. In this repository the browser (Chromium) and the server (Node 22) produced bit-identical outputs in the E2E run.

## Training
Loss: cross-entropy for softmax outputs, MSE `(1/n)Σ(a−y)²` otherwise. Mini-batch gradients averaged over the batch; masked weights never update. SGD with optional momentum; Adam β₁ 0.9, β₂ 0.999, ε 1e−8 with bias correction. Shuffle order comes from `trainer|artifactHash|datasetHash|seed`, so a training run is reproducible. Checkpoint = new version, `parentArtifactHash` = base artifact.
