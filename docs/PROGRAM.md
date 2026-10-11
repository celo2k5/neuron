# `neuron_registry` program

Anchor 0.32.1, built with `cargo build-sbf` (platform-tools v1.57). Localnet program id `BJmJe2GxxiTMiyrioiDrsM3RdUmRddA6TJQiFs6RoPDX` (from `programs/neuron_registry/localnet-program-keypair.json`, **localnet only** — generate a fresh keypair for devnet/mainnet).

## Accounts
| account | seeds | fields |
| --- | --- | --- |
| `Registry` | `["registry"]` | authority, commitments (u64), paused, bump |
| `Commitment` | `["commitment", experiment_id]` | owner, experiment_id, result_hash, artifact_hash, metadata_hash, slot, unix_timestamp, bump |

`experiment_id = SHA-256("neuron:experiment:v1|" + experiment UUID)`.

## Instructions
| ix | signer | effect | guards |
| --- | --- | --- | --- |
| `initialize` | authority (payer) | creates the registry | PDA `init` ⇒ only once |
| `set_paused(bool)` | authority | circuit breaker for new commits | `has_one = authority`, PDA seeds |
| `commit_experiment(id, result, artifact, metadata)` | owner (payer) | creates the commitment PDA, increments counter, emits `ExperimentCommitted` | registry PDA seeds; commitment PDA seeds bind `id` (substitution fails); `init` ⇒ duplicate ids fail (idempotent); zero hashes rejected; paused rejected |

The authority cannot edit or delete commitments. Upgrade authority of the deployed program is whoever deploys it; for mainnet it should be a multisig or be revoked — decide before launch.

## Tests (`npm run test:program`)
Boots a fresh `solana-test-validator` with the compiled `.so` and runs `packages/solana/test/localnet.test.ts`: initialise-once, commit + decode + verify, duplicate commit rejected, PDA and registry substitution rejected, zero-hash and missing-signer rejected, authority-only pause, plus a real SPL payment verified against its intent and four tampered intents rejected.
