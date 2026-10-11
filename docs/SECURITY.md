# Security model and trust assumptions

## Wallet authentication
- Challenges are server-issued, single-use (nonce consumed in the same transaction that creates the session/action), expire after 5 minutes and bind **domain, URI, cluster, intent, nonce, timestamps** and, for actions, a **payload hash computed by the server** from the action itself.
- The exact issued text must be returned; it is re-parsed and re-serialised (`parseChallenge`) so appended lines are rejected.
- Sessions: 32-byte random token in an `httpOnly; SameSite=Strict` cookie; only its SHA-256 is stored; sessions are cluster-bound and revocable (`DELETE /api/auth/session`).
- NEURON never asks for private keys. The localnet dev wallet is a browser-only burner and is not offered on any other cluster.

## Payments and credits
- Intents are created server-side with id, mint, decimals, exact integer amount, recipient, sender, a unique **reference** key and expiry.
- The client signature is only a lookup key. The worker independently fetches the transaction at the configured finality and checks: success, not after expiry, reference present, exactly one `transferChecked`, mint, recipient ATA, authority = intent sender, amount + decimals exact, memo `neuron:pay:<intent id>`, and the recipient's balance delta.
- `token_payments.signature` and `token_payments.intent_id` are unique; `credit_events (kind, ref_type, ref_id)` is unique; balances have `>= 0` checks. Double credit is impossible even with concurrent reconcilers.
- Credits are reserved before expensive work and released on failure/cancel (pro-rata for training).

## Compute isolation
- All arrays and model schemas are validated (`configIssues`, `assertVector`, `importModel` recomputes both hashes). No executable model formats exist; imports of arbitrary weights are refused.
- Hard caps: layers, widths, neurons, parameters, input magnitude, activation magnitude, dataset size, epochs, batch size.
- Training runs in a `worker_thread` with `maxOldGenerationSizeMb: 256` and a 180 s wall-clock cap, with no DB or network access.
- Rate limits are Postgres-backed fixed windows per IP or user.

## Data and storage
- Artifact keys are content hashes; reads verify the resolved path stays inside the store (path traversal test).
- Community neurons: owners can change only their own row (checked server-side under a row lock) and the signature binds the exact parameters.
- Logs are structured JSON with request ids and never include tokens, signatures of challenges or request bodies.

## Authorities
| authority | can | cannot |
| --- | --- | --- |
| API operator | see inputs, pause service, rotate env | forge on-chain commitments, move user tokens |
| Registry authority | pause new commits | alter/delete commitments |
| Program upgrade authority | upgrade program code | — (should be multisig/revoked before mainnet) |
| Treasury owner | spend received $NEURON | be moved by governance |
| Governance | change whitelisted community-network parameters after a delay | touch treasury, other users' neurons |

## Known gaps (before any mainnet use)
- Governance weight is the balance **at vote time**, not a historical snapshot; tokens can be moved and re-voted from another wallet.
- No external audit of the program or payment code.
- Rate limiting is per instance + DB; put a CDN/WAF in front for abuse protection.
- Artifact store adapter is filesystem; use an object store with versioning and backups in production.
- No prompt-injection surface exists because no AI helper is shipped.
