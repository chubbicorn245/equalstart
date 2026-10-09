//! EqualStart: a batch escrow whose pooled wSOL becomes the very first buy on a
//! Meteora Dynamic Bonding Curve (DBC) pool, inside the same transaction that
//! creates the pool.
//!
//! Trust model:
//! - Launch terms are fixed at `initialize_batch` and never mutable afterwards.
//! - Funds sit in PDA-owned SPL token vaults. The only instructions that move
//!   them are participant-signed (`withdraw`, `claim`, `refund`), the single
//!   PDA-signed DBC `swap2` CPI in `execute_batch`, and `burn_dust`.
//!   There is no creator/admin withdrawal path.
//! - Deadlines come from the `Clock` sysvar, never from caller input.
//! - `execute_batch` refuses to run unless the instruction immediately before it
//!   (top level, same transaction) is DBC `initialize_virtual_pool_with_spl_token`
//!   for the committed config/base mint/pool, and the pool has never been swapped.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{get_stack_height, AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Burn, Mint, Token, TokenAccount, TransferChecked},
};
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

declare_id!("6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j");

pub const BATCH_SEED: &[u8] = b"batch";
pub const CONTRIBUTION_SEED: &[u8] = b"deposit";
pub const QUOTE_VAULT_SEED: &[u8] = b"quote_vault";
pub const BASE_VAULT_SEED: &[u8] = b"base_vault";

/// Constants and byte layouts of Meteora DBC, pinned to IDL v0.2.1
/// (`@meteora-ag/dynamic-bonding-curve-sdk` 1.5.13, program source f552f20).
pub mod dbc {
    use super::*;

    pub const PROGRAM_ID: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
    pub const POOL_AUTHORITY: Pubkey = pubkey!("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
    /// PDA of `[b"__event_authority"]` under the DBC program.
    pub const EVENT_AUTHORITY: Pubkey = pubkey!("8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF");
    pub const POOL_SEED: &[u8] = b"pool";

    pub const SWAP2_DISCRIMINATOR: [u8; 8] = [65, 75, 63, 76, 235, 91, 91, 136];
    pub const INIT_SPL_POOL_DISCRIMINATOR: [u8; 8] = [140, 85, 215, 176, 102, 54, 104, 79];
    pub const VIRTUAL_POOL_DISCRIMINATOR: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];
    pub const POOL_CONFIG_DISCRIMINATOR: [u8; 8] = [26, 108, 14, 123, 116, 230, 129, 43];
    pub const SWAP_MODE_EXACT_IN: u8 = 0;

    // `initialize_virtual_pool_with_spl_token` account indices.
    pub const INIT_IX_CONFIG: usize = 0;
    pub const INIT_IX_BASE_MINT: usize = 3;
    pub const INIT_IX_QUOTE_MINT: usize = 4;
    pub const INIT_IX_POOL: usize = 5;

    // VirtualPool (bytemuck repr(C)) byte offsets, including the 8-byte discriminator.
    pub const VIRTUAL_POOL_LEN: usize = 424;
    pub const POOL_CONFIG_OFFSET: usize = 72;
    pub const POOL_BASE_MINT_OFFSET: usize = 136;
    pub const POOL_BASE_VAULT_OFFSET: usize = 168;
    pub const POOL_QUOTE_VAULT_OFFSET: usize = 200;
    pub const POOL_QUOTE_RESERVE_OFFSET: usize = 240;
    pub const POOL_HAS_SWAP_OFFSET: usize = 370;

    // PoolConfig (bytemuck repr(C)) byte offsets, including the 8-byte discriminator.
    pub const CONFIG_MIN_LEN: usize = 408;
    pub const CONFIG_QUOTE_MINT_OFFSET: usize = 8;
    pub const CONFIG_BASE_FEE_MODE_OFFSET: usize = 104 + 26;
    pub const CONFIG_TOKEN_TYPE_OFFSET: usize = 237;
    pub const CONFIG_MIGRATION_QUOTE_THRESHOLD_OFFSET: usize = 264;
    pub const CONFIG_FIRST_SWAP_MIN_FEE_OFFSET: usize = 365;
    pub const BASE_FEE_MODE_RATE_LIMITER: u8 = 2;
    pub const TOKEN_TYPE_SPL: u8 = 0;

    pub fn pool_address(config: &Pubkey, base_mint: &Pubkey, quote_mint: &Pubkey) -> Pubkey {
        let (hi, lo) = if base_mint > quote_mint {
            (base_mint, quote_mint)
        } else {
            (quote_mint, base_mint)
        };
        Pubkey::find_program_address(
            &[POOL_SEED, config.as_ref(), hi.as_ref(), lo.as_ref()],
            &PROGRAM_ID,
        )
        .0
    }

    pub fn read_pubkey(data: &[u8], offset: usize) -> Pubkey {
        Pubkey::new_from_array(data[offset..offset + 32].try_into().unwrap())
    }

    pub fn read_u64(data: &[u8], offset: usize) -> u64 {
        u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
    }
}

#[program]
pub mod equalstart {
    use super::*;

    pub fn initialize_batch(ctx: Context<InitializeBatch>, terms: BatchTerms) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(terms.closes_at > now, EqualStartError::BadDeadlines);
        require!(terms.expires_at > terms.closes_at, EqualStartError::BadDeadlines);
        require!(
            terms.per_wallet_cap > 0
                && terms.min_raise > 0
                && terms.max_pool_quote_in >= terms.min_raise
                && terms.min_base_out > 0,
            EqualStartError::BadTerms
        );
        require_keys_neq!(terms.base_mint, token::spl_token::native_mint::ID, EqualStartError::BadTerms);

        validate_dbc_config(&ctx.accounts.dbc_config, terms.max_pool_quote_in)?;

        let batch = &mut ctx.accounts.batch;
        batch.creator = ctx.accounts.creator.key();
        batch.launch_id = terms.launch_id;
        batch.dbc_config = ctx.accounts.dbc_config.key();
        batch.base_mint = terms.base_mint;
        batch.quote_mint = ctx.accounts.quote_mint.key();
        batch.pool = dbc::pool_address(&batch.dbc_config, &terms.base_mint, &batch.quote_mint);
        batch.quote_vault = ctx.accounts.quote_vault.key();
        batch.base_vault = Pubkey::find_program_address(
            &[BASE_VAULT_SEED, batch.key().as_ref()],
            &crate::ID,
        )
        .0;
        batch.closes_at = terms.closes_at;
        batch.expires_at = terms.expires_at;
        batch.per_wallet_cap = terms.per_wallet_cap;
        batch.min_raise = terms.min_raise;
        batch.max_pool_quote_in = terms.max_pool_quote_in;
        batch.min_base_out = terms.min_base_out;
        batch.phase = Phase::Open;
        batch.bump = ctx.bumps.batch;
        msg!("EqualStart batch {} committed to DBC pool {}", batch.key(), batch.pool);
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let batch = &mut ctx.accounts.batch;
        require!(batch.phase == Phase::Open && now < batch.closes_at, EqualStartError::DepositClosed);
        require!(amount > 0, EqualStartError::ZeroAmount);

        let contribution = &mut ctx.accounts.contribution;
        if contribution.batch == Pubkey::default() {
            contribution.batch = batch.key();
            contribution.participant = ctx.accounts.participant.key();
            contribution.bump = ctx.bumps.contribution;
        }
        let new_amount = contribution.amount.checked_add(amount).ok_or(EqualStartError::Overflow)?;
        require!(new_amount <= batch.per_wallet_cap, EqualStartError::WalletCapExceeded);
        let new_total = batch.total_quote.checked_add(amount).ok_or(EqualStartError::Overflow)?;
        require!(new_total <= batch.max_pool_quote_in, EqualStartError::BatchFull);

        if contribution.amount == 0 {
            batch.participants_count = batch.participants_count.checked_add(1).ok_or(EqualStartError::Overflow)?;
        }
        contribution.amount = new_amount;
        batch.total_quote = new_total;

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.participant_quote.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.quote_vault.to_account_info(),
                    authority: ctx.accounts.participant.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.quote_mint.decimals,
        )
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let batch = &mut ctx.accounts.batch;
        require!(batch.phase == Phase::Open && now < batch.closes_at, EqualStartError::DepositClosed);
        require!(amount > 0, EqualStartError::ZeroAmount);

        let contribution = &mut ctx.accounts.contribution;
        contribution.amount = contribution.amount.checked_sub(amount).ok_or(EqualStartError::InsufficientDeposit)?;
        batch.total_quote = batch.total_quote.checked_sub(amount).ok_or(EqualStartError::Overflow)?;
        if contribution.amount == 0 {
            batch.participants_count = batch.participants_count.checked_sub(1).ok_or(EqualStartError::Overflow)?;
        }

        transfer_from_vault(
            &ctx.accounts.token_program,
            batch,
            &ctx.accounts.quote_vault,
            &ctx.accounts.quote_mint,
            &ctx.accounts.participant_quote,
            amount,
        )
    }

    pub fn execute_batch(ctx: Context<ExecuteBatch>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let batch = &ctx.accounts.batch;
        require!(batch.phase == Phase::Open, EqualStartError::NotOpen);
        require!(now >= batch.closes_at && now < batch.expires_at, EqualStartError::NotInSettlementWindow);
        require!(batch.total_quote >= batch.min_raise, EqualStartError::MinRaiseNotMet);

        verify_pool_created_by_previous_instruction(&ctx.accounts.instructions_sysvar, batch)?;
        verify_pristine_pool(&ctx.accounts.pool, batch, &ctx.accounts.dbc_base_vault, &ctx.accounts.dbc_quote_vault)?;

        let amount_in = batch.total_quote;
        let quote_before = ctx.accounts.quote_vault.amount;
        let base_before = ctx.accounts.base_vault.amount;
        require!(quote_before >= amount_in, EqualStartError::VaultShortfall);

        let swap_ix = Instruction {
            program_id: dbc::PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(dbc::POOL_AUTHORITY, false),
                AccountMeta::new_readonly(batch.dbc_config, false),
                AccountMeta::new(batch.pool, false),
                AccountMeta::new(batch.quote_vault, false),
                AccountMeta::new(batch.base_vault, false),
                AccountMeta::new(ctx.accounts.dbc_base_vault.key(), false),
                AccountMeta::new(ctx.accounts.dbc_quote_vault.key(), false),
                AccountMeta::new_readonly(batch.base_mint, false),
                AccountMeta::new_readonly(batch.quote_mint, false),
                AccountMeta::new_readonly(batch.key(), true),
                AccountMeta::new_readonly(token::ID, false),
                AccountMeta::new_readonly(token::ID, false),
                // Optional `referral_token_account` = None is encoded as the program id.
                AccountMeta::new_readonly(dbc::PROGRAM_ID, false),
                AccountMeta::new_readonly(dbc::EVENT_AUTHORITY, false),
                AccountMeta::new_readonly(dbc::PROGRAM_ID, false),
            ],
            data: {
                let mut data = dbc::SWAP2_DISCRIMINATOR.to_vec();
                data.extend_from_slice(&amount_in.to_le_bytes());
                data.extend_from_slice(&batch.min_base_out.to_le_bytes());
                data.push(dbc::SWAP_MODE_EXACT_IN);
                data
            },
        };
        let launch_id = batch.launch_id.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[BATCH_SEED, batch.creator.as_ref(), &launch_id, &[batch.bump]];
        invoke_signed(
            &swap_ix,
            &[
                ctx.accounts.dbc_pool_authority.to_account_info(),
                ctx.accounts.dbc_config.to_account_info(),
                ctx.accounts.pool.to_account_info(),
                ctx.accounts.quote_vault.to_account_info(),
                ctx.accounts.base_vault.to_account_info(),
                ctx.accounts.dbc_base_vault.to_account_info(),
                ctx.accounts.dbc_quote_vault.to_account_info(),
                ctx.accounts.base_mint.to_account_info(),
                ctx.accounts.quote_mint.to_account_info(),
                ctx.accounts.batch.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.dbc_event_authority.to_account_info(),
                ctx.accounts.dbc_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        ctx.accounts.quote_vault.reload()?;
        ctx.accounts.base_vault.reload()?;
        let quote_spent = quote_before
            .checked_sub(ctx.accounts.quote_vault.amount)
            .ok_or(EqualStartError::Overflow)?;
        let base_received = ctx
            .accounts
            .base_vault
            .amount
            .checked_sub(base_before)
            .ok_or(EqualStartError::Overflow)?;
        require!(quote_spent == amount_in, EqualStartError::PartialFill);
        require!(base_received >= ctx.accounts.batch.min_base_out, EqualStartError::SlippageExceeded);

        let batch = &mut ctx.accounts.batch;
        batch.quote_spent = quote_spent;
        batch.base_received = base_received;
        batch.phase = Phase::Settled;
        msg!(
            "EqualStart settled: quote_spent={} base_received={} pool={}",
            quote_spent,
            base_received,
            batch.pool
        );
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let batch = &mut ctx.accounts.batch;
        require!(batch.phase == Phase::Settled, EqualStartError::NotSettled);
        let contribution = &mut ctx.accounts.contribution;
        require!(contribution.amount > 0, EqualStartError::NothingToClaim);
        require!(!contribution.claimed, EqualStartError::AlreadyClaimed);

        let share = (batch.base_received as u128)
            .checked_mul(contribution.amount as u128)
            .ok_or(EqualStartError::Overflow)?
            .checked_div(batch.total_quote as u128)
            .ok_or(EqualStartError::Overflow)?;
        let share = u64::try_from(share).map_err(|_| EqualStartError::Overflow)?;

        contribution.claimed = true;
        batch.claimed_count = batch.claimed_count.checked_add(1).ok_or(EqualStartError::Overflow)?;
        batch.total_claimed = batch.total_claimed.checked_add(share).ok_or(EqualStartError::Overflow)?;
        msg!("EqualStart claim: participant={} share={}", contribution.participant, share);

        if share == 0 {
            return Ok(());
        }
        transfer_from_vault(
            &ctx.accounts.token_program,
            batch,
            &ctx.accounts.base_vault,
            &ctx.accounts.base_mint,
            &ctx.accounts.participant_base,
            share,
        )
    }

    pub fn cancel_expired(ctx: Context<CancelExpired>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let batch = &mut ctx.accounts.batch;
        require!(batch.phase == Phase::Open, EqualStartError::NotOpen);
        require!(now >= batch.expires_at, EqualStartError::NotExpired);
        batch.phase = Phase::Cancelled;
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let batch = &ctx.accounts.batch;
        require!(batch.phase == Phase::Cancelled, EqualStartError::NotCancelled);
        let contribution = &mut ctx.accounts.contribution;
        require!(contribution.amount > 0, EqualStartError::NothingToRefund);
        require!(!contribution.refunded, EqualStartError::AlreadyRefunded);
        contribution.refunded = true;

        transfer_from_vault(
            &ctx.accounts.token_program,
            batch,
            &ctx.accounts.quote_vault,
            &ctx.accounts.quote_mint,
            &ctx.accounts.participant_quote,
            contribution.amount,
        )
    }

    pub fn burn_dust(ctx: Context<BurnDust>) -> Result<()> {
        let batch = &ctx.accounts.batch;
        require!(batch.phase == Phase::Settled, EqualStartError::NotSettled);
        require!(batch.claimed_count == batch.participants_count, EqualStartError::ClaimsOutstanding);
        let dust = ctx.accounts.base_vault.amount;
        require!(dust > 0, EqualStartError::ZeroAmount);

        let launch_id = batch.launch_id.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[BATCH_SEED, batch.creator.as_ref(), &launch_id, &[batch.bump]];
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.base_mint.to_account_info(),
                    from: ctx.accounts.base_vault.to_account_info(),
                    authority: ctx.accounts.batch.to_account_info(),
                },
                &[signer_seeds],
            ),
            dust,
        )
    }
}

fn transfer_from_vault<'info>(
    token_program: &Program<'info, Token>,
    batch: &Account<'info, Batch>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    destination: &Account<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    let launch_id = batch.launch_id.to_le_bytes();
    let signer_seeds: &[&[u8]] = &[BATCH_SEED, batch.creator.as_ref(), &launch_id, &[batch.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: batch.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
        mint.decimals,
    )
}

/// Reject DBC configs whose first-swap behaviour is incompatible with a CPI buy
/// or would let the swap fee depend on instruction context, and configs whose
/// curve the full batch could complete (the buy must stay a plain curve swap).
fn validate_dbc_config(config: &UncheckedAccount, max_pool_quote_in: u64) -> Result<()> {
    require_keys_eq!(*config.owner, dbc::PROGRAM_ID, EqualStartError::InvalidDbcConfig);
    let data = config.try_borrow_data()?;
    require!(
        data.len() >= dbc::CONFIG_MIN_LEN && data[..8] == dbc::POOL_CONFIG_DISCRIMINATOR,
        EqualStartError::InvalidDbcConfig
    );
    require_keys_eq!(
        dbc::read_pubkey(&data, dbc::CONFIG_QUOTE_MINT_OFFSET),
        token::spl_token::native_mint::ID,
        EqualStartError::InvalidDbcConfig
    );
    require!(data[dbc::CONFIG_TOKEN_TYPE_OFFSET] == dbc::TOKEN_TYPE_SPL, EqualStartError::InvalidDbcConfig);
    require!(
        data[dbc::CONFIG_BASE_FEE_MODE_OFFSET] != dbc::BASE_FEE_MODE_RATE_LIMITER,
        EqualStartError::InvalidDbcConfig
    );
    require!(data[dbc::CONFIG_FIRST_SWAP_MIN_FEE_OFFSET] == 0, EqualStartError::InvalidDbcConfig);
    require!(
        max_pool_quote_in < dbc::read_u64(&data, dbc::CONFIG_MIGRATION_QUOTE_THRESHOLD_OFFSET),
        EqualStartError::BadTerms
    );
    Ok(())
}

/// The instruction directly before this one, at the top level of this same
/// transaction, must be DBC's pool initialization for exactly the committed
/// config, base mint, quote mint and pool. Because DBC `init`s the pool account,
/// that instruction would fail if the pool already existed, so success proves
/// the pool was created in this transaction with nothing in between.
fn verify_pool_created_by_previous_instruction(instructions_sysvar: &UncheckedAccount, batch: &Batch) -> Result<()> {
    require!(get_stack_height() == 1, EqualStartError::NotTopLevel);
    let ix_sysvar = instructions_sysvar.to_account_info();
    let current = load_current_index_checked(&ix_sysvar)? as usize;
    let this_ix = load_instruction_at_checked(current, &ix_sysvar)?;
    require!(this_ix.program_id.to_bytes() == crate::ID.to_bytes(), EqualStartError::NotTopLevel);
    require!(current > 0, EqualStartError::PoolNotCreatedAtomically);

    let prev = load_instruction_at_checked(current - 1, &ix_sysvar)?;
    let account = |i: usize| prev.accounts.get(i).map(|a| a.pubkey.to_bytes());
    require!(
        prev.program_id.to_bytes() == dbc::PROGRAM_ID.to_bytes()
            && prev.data.get(..8) == Some(&dbc::INIT_SPL_POOL_DISCRIMINATOR[..])
            && account(dbc::INIT_IX_CONFIG) == Some(batch.dbc_config.to_bytes())
            && account(dbc::INIT_IX_BASE_MINT) == Some(batch.base_mint.to_bytes())
            && account(dbc::INIT_IX_QUOTE_MINT) == Some(batch.quote_mint.to_bytes())
            && account(dbc::INIT_IX_POOL) == Some(batch.pool.to_bytes()),
        EqualStartError::PoolNotCreatedAtomically
    );
    Ok(())
}

/// Independently of instruction introspection, the live pool state must belong to
/// the committed config/base mint and show no prior trade.
fn verify_pristine_pool(
    pool: &UncheckedAccount,
    batch: &Batch,
    dbc_base_vault: &UncheckedAccount,
    dbc_quote_vault: &UncheckedAccount,
) -> Result<()> {
    require_keys_eq!(*pool.owner, dbc::PROGRAM_ID, EqualStartError::InvalidPool);
    let data = pool.try_borrow_data()?;
    require!(
        data.len() >= dbc::VIRTUAL_POOL_LEN && data[..8] == dbc::VIRTUAL_POOL_DISCRIMINATOR,
        EqualStartError::InvalidPool
    );
    require_keys_eq!(dbc::read_pubkey(&data, dbc::POOL_CONFIG_OFFSET), batch.dbc_config, EqualStartError::InvalidPool);
    require_keys_eq!(dbc::read_pubkey(&data, dbc::POOL_BASE_MINT_OFFSET), batch.base_mint, EqualStartError::InvalidPool);
    require_keys_eq!(dbc::read_pubkey(&data, dbc::POOL_BASE_VAULT_OFFSET), dbc_base_vault.key(), EqualStartError::InvalidPool);
    require_keys_eq!(dbc::read_pubkey(&data, dbc::POOL_QUOTE_VAULT_OFFSET), dbc_quote_vault.key(), EqualStartError::InvalidPool);
    require!(
        data[dbc::POOL_HAS_SWAP_OFFSET] == 0 && dbc::read_u64(&data, dbc::POOL_QUOTE_RESERVE_OFFSET) == 0,
        EqualStartError::PoolAlreadyTraded
    );
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BatchTerms {
    pub launch_id: u64,
    pub base_mint: Pubkey,
    pub closes_at: i64,
    pub expires_at: i64,
    pub per_wallet_cap: u64,
    pub min_raise: u64,
    pub max_pool_quote_in: u64,
    pub min_base_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Phase {
    Open,
    Settled,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct Batch {
    pub creator: Pubkey,
    pub launch_id: u64,
    pub dbc_config: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub pool: Pubkey,
    pub quote_vault: Pubkey,
    pub base_vault: Pubkey,
    pub closes_at: i64,
    pub expires_at: i64,
    pub per_wallet_cap: u64,
    pub min_raise: u64,
    pub max_pool_quote_in: u64,
    pub min_base_out: u64,
    pub phase: Phase,
    pub total_quote: u64,
    pub quote_spent: u64,
    pub base_received: u64,
    pub total_claimed: u64,
    pub participants_count: u32,
    pub claimed_count: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Contribution {
    pub batch: Pubkey,
    pub participant: Pubkey,
    pub amount: u64,
    pub claimed: bool,
    pub refunded: bool,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(terms: BatchTerms)]
pub struct InitializeBatch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Batch::INIT_SPACE,
        seeds = [BATCH_SEED, creator.key().as_ref(), &terms.launch_id.to_le_bytes()],
        bump,
    )]
    pub batch: Account<'info, Batch>,
    #[account(address = token::spl_token::native_mint::ID)]
    pub quote_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        seeds = [QUOTE_VAULT_SEED, batch.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = batch,
    )]
    pub quote_vault: Account<'info, TokenAccount>,
    /// CHECK: owner, discriminator and fields validated in `validate_dbc_config`.
    pub dbc_config: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(mut)]
    pub batch: Account<'info, Batch>,
    #[account(
        init_if_needed,
        payer = participant,
        space = 8 + Contribution::INIT_SPACE,
        seeds = [CONTRIBUTION_SEED, batch.key().as_ref(), participant.key().as_ref()],
        bump,
    )]
    pub contribution: Account<'info, Contribution>,
    #[account(mut, token::mint = quote_mint, token::authority = participant)]
    pub participant_quote: Account<'info, TokenAccount>,
    #[account(mut, address = batch.quote_vault)]
    pub quote_vault: Account<'info, TokenAccount>,
    #[account(address = batch.quote_mint)]
    pub quote_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub participant: Signer<'info>,
    #[account(mut)]
    pub batch: Account<'info, Batch>,
    #[account(
        mut,
        seeds = [CONTRIBUTION_SEED, batch.key().as_ref(), participant.key().as_ref()],
        bump = contribution.bump,
    )]
    pub contribution: Account<'info, Contribution>,
    #[account(mut, token::mint = quote_mint, token::authority = participant)]
    pub participant_quote: Account<'info, TokenAccount>,
    #[account(mut, address = batch.quote_vault)]
    pub quote_vault: Account<'info, TokenAccount>,
    #[account(address = batch.quote_mint)]
    pub quote_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ExecuteBatch<'info> {
    /// Anyone may pay; the payer gains no rights over the batch.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub batch: Account<'info, Batch>,
    #[account(mut, address = batch.quote_vault)]
    pub quote_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        seeds = [BASE_VAULT_SEED, batch.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = batch,
    )]
    pub base_vault: Account<'info, TokenAccount>,
    #[account(address = batch.base_mint)]
    pub base_mint: Account<'info, Mint>,
    #[account(address = batch.quote_mint)]
    pub quote_mint: Account<'info, Mint>,
    /// CHECK: address pinned to the committed pool; contents checked in `verify_pristine_pool`.
    #[account(mut, address = batch.pool)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: address pinned to the committed config.
    #[account(address = batch.dbc_config)]
    pub dbc_config: UncheckedAccount<'info>,
    /// CHECK: must equal the vault recorded in the pool state (checked) and is re-validated by DBC.
    #[account(mut)]
    pub dbc_base_vault: UncheckedAccount<'info>,
    /// CHECK: must equal the vault recorded in the pool state (checked) and is re-validated by DBC.
    #[account(mut)]
    pub dbc_quote_vault: UncheckedAccount<'info>,
    /// CHECK: fixed DBC PDA.
    #[account(address = dbc::POOL_AUTHORITY)]
    pub dbc_pool_authority: UncheckedAccount<'info>,
    /// CHECK: fixed DBC PDA.
    #[account(address = dbc::EVENT_AUTHORITY)]
    pub dbc_event_authority: UncheckedAccount<'info>,
    /// CHECK: fixed DBC program id.
    #[account(address = dbc::PROGRAM_ID)]
    pub dbc_program: UncheckedAccount<'info>,
    /// CHECK: fixed instructions sysvar id.
    #[account(address = solana_instructions_sysvar::ID.to_bytes().into())]
    pub instructions_sysvar: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(mut)]
    pub batch: Account<'info, Batch>,
    #[account(
        mut,
        seeds = [CONTRIBUTION_SEED, batch.key().as_ref(), participant.key().as_ref()],
        bump = contribution.bump,
    )]
    pub contribution: Account<'info, Contribution>,
    #[account(mut, address = batch.base_vault)]
    pub base_vault: Account<'info, TokenAccount>,
    #[account(address = batch.base_mint)]
    pub base_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = participant,
        associated_token::mint = base_mint,
        associated_token::authority = participant,
    )]
    pub participant_base: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelExpired<'info> {
    #[account(mut)]
    pub batch: Account<'info, Batch>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    pub participant: Signer<'info>,
    pub batch: Account<'info, Batch>,
    #[account(
        mut,
        seeds = [CONTRIBUTION_SEED, batch.key().as_ref(), participant.key().as_ref()],
        bump = contribution.bump,
    )]
    pub contribution: Account<'info, Contribution>,
    #[account(mut, token::mint = quote_mint, token::authority = participant)]
    pub participant_quote: Account<'info, TokenAccount>,
    #[account(mut, address = batch.quote_vault)]
    pub quote_vault: Account<'info, TokenAccount>,
    #[account(address = batch.quote_mint)]
    pub quote_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BurnDust<'info> {
    pub batch: Account<'info, Batch>,
    #[account(mut, address = batch.base_vault)]
    pub base_vault: Account<'info, TokenAccount>,
    #[account(mut, address = batch.base_mint)]
    pub base_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum EqualStartError {
    #[msg("Deadlines must satisfy now < closes_at < expires_at")]
    BadDeadlines,
    #[msg("Launch terms are zero or inconsistent")]
    BadTerms,
    #[msg("DBC config is not a wSOL/SPL config with rate limiter and first-swap-min-fee disabled")]
    InvalidDbcConfig,
    #[msg("Deposits and withdrawals are closed")]
    DepositClosed,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Per-wallet cap exceeded")]
    WalletCapExceeded,
    #[msg("Batch would exceed max_pool_quote_in")]
    BatchFull,
    #[msg("Withdrawal exceeds deposit")]
    InsufficientDeposit,
    #[msg("Batch is not open")]
    NotOpen,
    #[msg("Outside the settlement window")]
    NotInSettlementWindow,
    #[msg("Minimum raise not met")]
    MinRaiseNotMet,
    #[msg("execute_batch must be a top-level instruction")]
    NotTopLevel,
    #[msg("Previous instruction must initialize the committed DBC pool in this transaction")]
    PoolNotCreatedAtomically,
    #[msg("Pool account does not match the committed DBC pool")]
    InvalidPool,
    #[msg("Pool has already been traded")]
    PoolAlreadyTraded,
    #[msg("Quote vault holds less than the batch total")]
    VaultShortfall,
    #[msg("DBC did not consume the full pooled quote amount")]
    PartialFill,
    #[msg("Base output below committed minimum")]
    SlippageExceeded,
    #[msg("Batch is not settled")]
    NotSettled,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Batch has not expired")]
    NotExpired,
    #[msg("Batch is not cancelled")]
    NotCancelled,
    #[msg("Nothing to refund")]
    NothingToRefund,
    #[msg("Already refunded")]
    AlreadyRefunded,
    #[msg("Not every participant has claimed")]
    ClaimsOutstanding,
}
