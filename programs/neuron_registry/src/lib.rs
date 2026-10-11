//! NEURON experiment commitment registry.
//!
//! Stores a commitment (hashes only) for an off-chain experiment. A commitment
//! proves that `owner` recorded these hashes at `slot`; it does NOT prove the
//! off-chain computation was correct.
use anchor_lang::prelude::*;

declare_id!("BJmJe2GxxiTMiyrioiDrsM3RdUmRddA6TJQiFs6RoPDX");

pub const REGISTRY_SEED: &[u8] = b"registry";
pub const COMMITMENT_SEED: &[u8] = b"commitment";

#[program]
pub mod neuron_registry {
    use super::*;

    /// One-time setup. The registry PDA can only be created once.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let r = &mut ctx.accounts.registry;
        r.authority = ctx.accounts.authority.key();
        r.commitments = 0;
        r.paused = false;
        r.bump = ctx.bumps.registry;
        Ok(())
    }

    /// Authority-only circuit breaker.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.registry.paused = paused;
        Ok(())
    }

    /// Record a commitment. The PDA is derived from `experiment_id`, so a second
    /// commit for the same id fails (account already in use): idempotent by construction.
    pub fn commit_experiment(
        ctx: Context<CommitExperiment>,
        experiment_id: [u8; 32],
        result_hash: [u8; 32],
        artifact_hash: [u8; 32],
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.registry.paused, RegistryError::Paused);
        require!(result_hash != [0u8; 32], RegistryError::EmptyHash);
        require!(artifact_hash != [0u8; 32], RegistryError::EmptyHash);
        let clock = Clock::get()?;
        let c = &mut ctx.accounts.commitment;
        c.owner = ctx.accounts.owner.key();
        c.experiment_id = experiment_id;
        c.result_hash = result_hash;
        c.artifact_hash = artifact_hash;
        c.metadata_hash = metadata_hash;
        c.slot = clock.slot;
        c.unix_timestamp = clock.unix_timestamp;
        c.bump = ctx.bumps.commitment;
        let r = &mut ctx.accounts.registry;
        r.commitments = r.commitments.checked_add(1).ok_or(RegistryError::Overflow)?;
        emit!(ExperimentCommitted {
            experiment_id,
            owner: c.owner,
            result_hash,
            artifact_hash,
            slot: c.slot,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Registry::SIZE, seeds = [REGISTRY_SEED], bump)]
    pub registry: Account<'info, Registry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [REGISTRY_SEED], bump = registry.bump, has_one = authority @ RegistryError::Unauthorized)]
    pub registry: Account<'info, Registry>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(experiment_id: [u8; 32])]
pub struct CommitExperiment<'info> {
    #[account(mut, seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Account<'info, Registry>,
    #[account(
        init,
        payer = owner,
        space = 8 + Commitment::SIZE,
        seeds = [COMMITMENT_SEED, experiment_id.as_ref()],
        bump
    )]
    pub commitment: Account<'info, Commitment>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Registry {
    pub authority: Pubkey,
    pub commitments: u64,
    pub paused: bool,
    pub bump: u8,
}
impl Registry {
    pub const SIZE: usize = 32 + 8 + 1 + 1;
}

#[account]
pub struct Commitment {
    pub owner: Pubkey,
    pub experiment_id: [u8; 32],
    pub result_hash: [u8; 32],
    pub artifact_hash: [u8; 32],
    pub metadata_hash: [u8; 32],
    pub slot: u64,
    pub unix_timestamp: i64,
    pub bump: u8,
}
impl Commitment {
    pub const SIZE: usize = 32 + 32 * 4 + 8 + 8 + 1;
}

#[event]
pub struct ExperimentCommitted {
    pub experiment_id: [u8; 32],
    pub owner: Pubkey,
    pub result_hash: [u8; 32],
    pub artifact_hash: [u8; 32],
    pub slot: u64,
}

#[error_code]
pub enum RegistryError {
    #[msg("registry is paused")]
    Paused,
    #[msg("hash must not be all zeros")]
    EmptyHash,
    #[msg("signer is not the registry authority")]
    Unauthorized,
    #[msg("counter overflow")]
    Overflow,
}
