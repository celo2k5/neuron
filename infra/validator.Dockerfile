FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates bzip2 && rm -rf /var/lib/apt/lists/*
RUN sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"
COPY programs/neuron_registry/target/deploy/neuron_registry.so /program.so
COPY programs/neuron_registry/localnet-program-keypair.json /program-keypair.json
CMD ["sh", "-c", "solana-test-validator --ledger /ledger --bind-address 0.0.0.0 --rpc-port 8899 --limit-ledger-size 50000000 --bpf-program $(solana-keygen pubkey /program-keypair.json) /program.so"]
