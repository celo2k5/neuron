# Security model and trust assumptions

## Wallet authentication
- Challenges are server-issued, single-use (nonce consumed in the same transaction that creates the session/action), expire after 5 minutes and bind **domain, URI, cluster, intent, nonce, timestamps** and, for actions, a **payload hash computed by the server** from the action itself.
- The exact issued text must be returned; it is re-parsed and re-serialised (`parseChallenge`) so appended lines are rejected.
- Sessions: 32-byte random token in an `httpOnly; SameSite=Strict` cookie; only its SHA-256 is stored; sessions are revocable (`DELETE /api/auth/session`).
- NEURON never asks for private keys. The localnet dev wallet is a browser-only burner and is not offered on any other cluster.

## Registry
- Append-only log `registry_entries`: gap-free `seq`, each `entry_hash` = SHA-256 of the canonical entry including `prev_hash`, signed (ed25519) with the registry key. A database trigger refuses `UPDATE` and `DELETE`; writes are serialised with an advisory lock.
- Verification recomputes the experiment's hashes from stored data, the entry hash, the signature and the link to the previous entry. The whole chain is re-walked on the Ledger and `/api/metrics`, which alerts if it breaks.
- The signing key comes from `REGISTRY_SIGNING_KEY` (preferred in production, kept in the host's secret store) or is generated once and stored in `registry_keys`. Public keys are published on the Ledger.
- Trust: the operator holds the key, so the operator could in principle rebuild the whole chain. Anyone who saved an earlier head hash or entry can detect that. Anchoring the head externally would remove this trust.

## Credits
- Daily claims are `credit_events (kind='claim', ref_type='daily', ref_id='<user>:<UTC date>')`; the unique key makes a second claim the same day a no-op.
- Credits are reserved before expensive work and released on failure/cancel (pro-rata for training).

## Optional token payments (off unless `NEURON_MINT` and `TREASURY_OWNER` are set)
- Intents are created server-side with id, mint, decimals, exact integer amount, recipient, sender, a unique **reference** key and expiry.
- The client signature is only a lookup key. The worker independently fetches the transaction at the configured finality and checks: success, not after expiry, reference present, exactly one `transferChecked`, mint, recipient ATA, authority = intent sender, amount + decimals exact, memo `neuron:pay:<intent id>`, and the recipient's balance delta.
- `token_payments.signature` and `token_payments.intent_id` are unique; `credit_events (kind, ref_type, ref_id)` is unique; balances have `>= 0` checks. Double credit is impossible even with concurrent reconcilers.

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
| API operator | see inputs, pause service, rotate env, hold the registry key | edit a recorded entry without breaking its hash, signature and every later link |
| Governance | change whitelisted community-network parameters after a delay | touch credits, funds, other users' neurons |

## Known gaps
- One wallet, one vote: a person with many wallets gets many votes. Proposals are capped at two open per wallet and rate limited.
- The registry head is not anchored outside the operator's database.
- Rate limiting is per instance + DB; put a CDN/WAF in front for abuse protection.
- Artifact store adapter is filesystem; use an object store with versioning and backups in production.
- No prompt-injection surface exists because no AI helper is shipped.
