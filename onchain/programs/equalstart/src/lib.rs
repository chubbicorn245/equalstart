//! EqualStart: a batch escrow whose pooled wSOL becomes the very first buy on a
//! Meteora Dynamic Bonding Curve (DBC) pool, in the same instruction that
//! creates the pool.
//!
//! Trust model:
//! - Launch terms (DBC config, token metadata, deadlines, caps, fee ceiling,
//!   minimum price) are fixed at `initialize_batch` and never mutable afterwards.
//! - Funds sit in PDA-owned SPL token vaults. The only instructions that move
//!   them are participant-signed (`withdraw`, `claim`, `refund`), the single
//!   PDA-signed DBC `swap2` CPI in `settle`, and `burn_dust`.
//!   There is no creator/admin withdrawal path.
//! - `settle` is permissionless. The base mint is a PDA of the batch and the
//!   batch PDA is the DBC pool creator, so EqualStart is the only party able to
//!   sign the DBC pool creation. `settle` creates the pool and buys from it in
//!   one instruction, so no trade can precede the batch buy, and settlement
//!   needs no cooperation from the creator.
//! - Deadlines come from the `Clock` sysvar, never from caller input.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::{
    associated_token::{self, get_associated_token_address, AssociatedToken},
    token::{self, Burn, Mint, Token, TokenAccount, TransferChecked},
};

declare_id!("6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j");

pub const BATCH_SEED: &[u8] = b"batch";
pub const CONTRIBUTION_SEED: &[u8] = b"deposit";
pub const QUOTE_VAULT_SEED: &[u8] = b"quote_vault";
pub const MINT_SEED: &[u8] = b"mint";

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;
pub const BPS_DENOMINATOR: u128 = 10_000;
/// `min_base_per_sol` is quoted per whole SOL (1e9 lamports of wSOL).
pub const LAMPORTS_PER_QUOTE_UNIT: u128 = 1_000_000_000;

/// Constants and byte layouts of Meteora DBC, pinned to IDL v0.2.1
/// (`@meteora-ag/dynamic-bonding-curve-sdk` 1.5.13, program source f552f20).
pub mod dbc {
    use super::*;

    pub const PROGRAM_ID: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
    pub const POOL_AUTHORITY: Pubkey = pubkey!("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
    /// PDA of `[b"__event_authority"]` under the DBC program.
    pub const EVENT_AUTHORITY: Pubkey = pubkey!("8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF");
    pub const METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    pub const POOL_SEED: &[u8] = b"pool";
    pub const TOKEN_VAULT_SEED: &[u8] = b"token_vault";

    pub const SWAP2_DISCRIMINATOR: [u8; 8] = [65, 75, 63, 76, 235, 91, 91, 136];
    pub const INIT_SPL_POOL_DISCRIMINATOR: [u8; 8] = [140, 85, 215, 176, 102, 54, 104, 79];
    pub const TRANSFER_POOL_CREATOR_DISCRIMINATOR: [u8; 8] = [20, 7, 169, 33, 58, 147, 166, 33];
    pub const VIRTUAL_POOL_DISCRIMINATOR: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];
    pub const POOL_CONFIG_DISCRIMINATOR: [u8; 8] = [26, 108, 14, 123, 116, 230, 129, 43];
    pub const SWAP_MODE_EXACT_IN: u8 = 0;
    pub const FEE_DENOMINATOR: u128 = 1_000_000_000;

    // VirtualPool (bytemuck repr(C)) byte offsets, including the 8-byte discriminator.
    pub const VIRTUAL_POOL_LEN: usize = 424;
    pub const POOL_CONFIG_OFFSET: usize = 72;
    pub const POOL_CREATOR_OFFSET: usize = 104;
    pub const POOL_BASE_MINT_OFFSET: usize = 136;
    pub const POOL_BASE_VAULT_OFFSET: usize = 168;
    pub const POOL_QUOTE_VAULT_OFFSET: usize = 200;
    pub const POOL_QUOTE_RESERVE_OFFSET: usize = 240;
    pub const POOL_TOTAL_PROTOCOL_BASE_FEE_OFFSET: usize = 312;
    pub const POOL_TOTAL_PROTOCOL_QUOTE_FEE_OFFSET: usize = 320;
    pub const POOL_TOTAL_TRADING_BASE_FEE_OFFSET: usize = 328;
    pub const POOL_TOTAL_TRADING_QUOTE_FEE_OFFSET: usize = 336;
    pub const POOL_HAS_SWAP_OFFSET: usize = 370;

    // PoolConfig (bytemuck repr(C)) byte offsets, including the 8-byte discriminator.
    pub const CONFIG_MIN_LEN: usize = 408;
    pub const CONFIG_QUOTE_MINT_OFFSET: usize = 8;
    pub const CONFIG_CLIFF_FEE_NUMERATOR_OFFSET: usize = 104;
    pub const CONFIG_BASE_FEE_MODE_OFFSET: usize = 104 + 26;
    pub const CONFIG_COLLECT_FEE_MODE_OFFSET: usize = 232;
    pub const CONFIG_TOKEN_TYPE_OFFSET: usize = 237;
    pub const CONFIG_MIGRATION_QUOTE_THRESHOLD_OFFSET: usize = 264;
    pub const CONFIG_FIRST_SWAP_MIN_FEE_OFFSET: usize = 365;
    pub const BASE_FEE_MODE_RATE_LIMITER: u8 = 2;
    pub const TOKEN_TYPE_SPL: u8 = 0;
    pub const COLLECT_FEE_MODE_QUOTE: u8 = 0;
    pub const COLLECT_FEE_MODE_OUTPUT: u8 = 1;

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

    pub fn borsh_string(data: &mut Vec<u8>, s: &str) {
        data.extend_from_slice(&(s.len() as u32).to_le_bytes());
        data.extend_from_slice(s.as_bytes());
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
                && terms.min_base_per_sol > 0
                && u128::from(terms.max_opening_fee_bps) < BPS_DENOMINATOR,
            EqualStartError::BadTerms
        );
        require!(
            !terms.token_name.is_empty()
                && terms.token_name.len() <= MAX_NAME_LEN
                && !terms.token_symbol.is_empty()
                && terms.token_symbol.len() <= MAX_SYMBOL_LEN
                && terms.token_uri.len() <= MAX_URI_LEN,
            EqualStartError::BadTerms
        );
        // Settling must stay possible for the largest allowed batch.
        min_base_out_for(terms.max_pool_quote_in, terms.min_base_per_sol)?;

        validate_dbc_config(&ctx.accounts.dbc_config, &terms)?;

        let batch_key = ctx.accounts.batch.key();
        let base_mint = Pubkey::find_program_address(&[MINT_SEED, batch_key.as_ref()], &crate::ID).0;
        let quote_mint = ctx.accounts.quote_mint.key();
        let dbc_config = ctx.accounts.dbc_config.key();

        if terms.settler_bounty > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.creator.to_account_info(),
                        to: ctx.accounts.batch.to_account_info(),
                    },
                ),
                terms.settler_bounty,
            )?;
        }

        let batch = &mut ctx.accounts.batch;
        batch.creator = ctx.accounts.creator.key();
        batch.launch_id = terms.launch_id;
        batch.dbc_config = dbc_config;
        batch.base_mint = base_mint;
        batch.quote_mint = quote_mint;
        batch.pool = dbc::pool_address(&dbc_config, &base_mint, &quote_mint);
        batch.quote_vault = ctx.accounts.quote_vault.key();
        batch.base_vault = get_associated_token_address(&batch_key, &base_mint);
        batch.closes_at = terms.closes_at;
        batch.expires_at = terms.expires_at;
        batch.per_wallet_cap = terms.per_wallet_cap;
        batch.min_raise = terms.min_raise;
        batch.max_pool_quote_in = terms.max_pool_quote_in;
        batch.min_base_per_sol = terms.min_base_per_sol;
        batch.max_opening_fee_bps = terms.max_opening_fee_bps;
        batch.settler_bounty = terms.settler_bounty;
        batch.token_name = terms.token_name;
        batch.token_symbol = terms.token_symbol;
        batch.token_uri = terms.token_uri;
        batch.phase = Phase::Open;
        batch.bump = ctx.bumps.batch;
        batch.mint_bump = Pubkey::find_program_address(&[MINT_SEED, batch_key.as_ref()], &crate::ID).1;
        msg!("EqualStart batch {} committed to DBC pool {} base mint {}", batch_key, batch.pool, base_mint);
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

    /// Permissionless settlement: create the committed DBC pool with the batch
    /// PDA as creator and a batch-PDA mint, buy with the whole batch, hand the
    /// DBC creator role to the committed creator, and pay the settler bounty.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let batch = &ctx.accounts.batch;
        require!(batch.phase == Phase::Open, EqualStartError::NotOpen);
        require!(now >= batch.closes_at && now < batch.expires_at, EqualStartError::NotInSettlementWindow);
        require!(batch.total_quote >= batch.min_raise, EqualStartError::MinRaiseNotMet);

        let amount_in = batch.total_quote;
        let min_base_out = min_base_out_for(amount_in, batch.min_base_per_sol)?;
        let quote_before = ctx.accounts.quote_vault.amount;
        require!(quote_before >= amount_in, EqualStartError::VaultShortfall);

        let batch_key = batch.key();
        let launch_id = batch.launch_id.to_le_bytes();
        let batch_seeds: &[&[u8]] = &[BATCH_SEED, batch.creator.as_ref(), &launch_id, &[batch.bump]];
        let mint_seeds: &[&[u8]] = &[MINT_SEED, batch_key.as_ref(), &[batch.mint_bump]];

        // 1. DBC creates the pool. Only EqualStart can sign for the base mint and
        //    the creator, so this pool cannot exist before this instruction.
        let init_ix = Instruction {
            program_id: dbc::PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(batch.dbc_config, false),
                AccountMeta::new_readonly(dbc::POOL_AUTHORITY, false),
                AccountMeta::new_readonly(batch_key, true),
                AccountMeta::new(batch.base_mint, true),
                AccountMeta::new_readonly(batch.quote_mint, false),
                AccountMeta::new(batch.pool, false),
                AccountMeta::new(ctx.accounts.dbc_base_vault.key(), false),
                AccountMeta::new(ctx.accounts.dbc_quote_vault.key(), false),
                AccountMeta::new(ctx.accounts.mint_metadata.key(), false),
                AccountMeta::new_readonly(dbc::METADATA_PROGRAM_ID, false),
                AccountMeta::new(ctx.accounts.settler.key(), true),
                AccountMeta::new_readonly(token::ID, false),
                AccountMeta::new_readonly(token::ID, false),
                AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
                AccountMeta::new_readonly(dbc::EVENT_AUTHORITY, false),
                AccountMeta::new_readonly(dbc::PROGRAM_ID, false),
            ],
            data: {
                let mut data = dbc::INIT_SPL_POOL_DISCRIMINATOR.to_vec();
                dbc::borsh_string(&mut data, &batch.token_name);
                dbc::borsh_string(&mut data, &batch.token_symbol);
                dbc::borsh_string(&mut data, &batch.token_uri);
                data
            },
        };
        invoke_signed(
            &init_ix,
            &[
                ctx.accounts.dbc_config.to_account_info(),
                ctx.accounts.dbc_pool_authority.to_account_info(),
                ctx.accounts.batch.to_account_info(),
                ctx.accounts.base_mint.to_account_info(),
                ctx.accounts.quote_mint.to_account_info(),
                ctx.accounts.pool.to_account_info(),
                ctx.accounts.dbc_base_vault.to_account_info(),
                ctx.accounts.dbc_quote_vault.to_account_info(),
                ctx.accounts.mint_metadata.to_account_info(),
                ctx.accounts.metadata_program.to_account_info(),
                ctx.accounts.settler.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.dbc_event_authority.to_account_info(),
                ctx.accounts.dbc_program.to_account_info(),
            ],
            &[batch_seeds, mint_seeds],
        )?;
        verify_pristine_pool(&ctx.accounts.pool, batch, &ctx.accounts.dbc_base_vault, &ctx.accounts.dbc_quote_vault)?;

        // 2. Batch base vault: the batch PDA's ATA for the new mint.
        associated_token::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.key(),
            associated_token::Create {
                payer: ctx.accounts.settler.to_account_info(),
                associated_token: ctx.accounts.base_vault.to_account_info(),
                authority: ctx.accounts.batch.to_account_info(),
                mint: ctx.accounts.base_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;
        let base_before = token_amount(&ctx.accounts.base_vault)?;

        // 3. The first and only swap in this instruction: the whole batch, ExactIn.
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
                AccountMeta::new_readonly(batch_key, true),
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
                data.extend_from_slice(&min_base_out.to_le_bytes());
                data.push(dbc::SWAP_MODE_EXACT_IN);
                data
            },
        };
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
            &[batch_seeds],
        )?;

        ctx.accounts.quote_vault.reload()?;
        let quote_spent = quote_before
            .checked_sub(ctx.accounts.quote_vault.amount)
            .ok_or(EqualStartError::Overflow)?;
        let base_received = token_amount(&ctx.accounts.base_vault)?
            .checked_sub(base_before)
            .ok_or(EqualStartError::Overflow)?;
        require!(quote_spent == amount_in, EqualStartError::PartialFill);
        require!(base_received >= min_base_out, EqualStartError::SlippageExceeded);
        let opening_fee = verify_opening_fee(&ctx.accounts.pool, &ctx.accounts.dbc_config, batch, quote_spent, base_received)?;

        // 4. Hand the DBC pool-creator role (creator fees, surplus) to the
        //    committed creator. Nothing else about the pool depends on it.
        let transfer_creator_ix = Instruction {
            program_id: dbc::PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(batch.pool, false),
                AccountMeta::new_readonly(batch.dbc_config, false),
                AccountMeta::new_readonly(batch_key, true),
                AccountMeta::new_readonly(batch.creator, false),
                AccountMeta::new_readonly(dbc::EVENT_AUTHORITY, false),
                AccountMeta::new_readonly(dbc::PROGRAM_ID, false),
            ],
            data: dbc::TRANSFER_POOL_CREATOR_DISCRIMINATOR.to_vec(),
        };
        invoke_signed(
            &transfer_creator_ix,
            &[
                ctx.accounts.pool.to_account_info(),
                ctx.accounts.dbc_config.to_account_info(),
                ctx.accounts.batch.to_account_info(),
                ctx.accounts.creator.to_account_info(),
                ctx.accounts.dbc_event_authority.to_account_info(),
                ctx.accounts.dbc_program.to_account_info(),
            ],
            &[batch_seeds],
        )?;
        {
            let data = ctx.accounts.pool.try_borrow_data()?;
            require_keys_eq!(dbc::read_pubkey(&data, dbc::POOL_CREATOR_OFFSET), batch.creator, EqualStartError::InvalidPool);
        }

        // 5. Pay the settler bounty that the creator escrowed at initialization.
        let bounty = batch.settler_bounty;
        move_lamports(&ctx.accounts.batch.to_account_info(), &ctx.accounts.settler.to_account_info(), bounty)?;

        let batch = &mut ctx.accounts.batch;
        batch.settler_bounty = 0;
        batch.quote_spent = quote_spent;
        batch.base_received = base_received;
        batch.phase = Phase::Settled;
        msg!(
            "EqualStart settled: quote_spent={} base_received={} min_base_out={} opening_fee={} pool={} settler={}",
            quote_spent,
            base_received,
            min_base_out,
            opening_fee,
            batch.pool,
            ctx.accounts.settler.key()
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

    /// Permissionless: after expiry an unsettled batch becomes refundable and the
    /// unused settler bounty returns to the creator.
    pub fn cancel_expired(ctx: Context<CancelExpired>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let batch = &ctx.accounts.batch;
        require!(batch.phase == Phase::Open, EqualStartError::NotOpen);
        require!(now >= batch.expires_at, EqualStartError::NotExpired);
        let bounty = batch.settler_bounty;
        move_lamports(&ctx.accounts.batch.to_account_info(), &ctx.accounts.creator.to_account_info(), bounty)?;
        let batch = &mut ctx.accounts.batch;
        batch.settler_bounty = 0;
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

/// floor(total_quote * min_base_per_sol / 1e9), at least 1, in u128.
fn min_base_out_for(total_quote: u64, min_base_per_sol: u64) -> Result<u64> {
    let min_out = (total_quote as u128)
        .checked_mul(min_base_per_sol as u128)
        .ok_or(EqualStartError::Overflow)?
        .checked_div(LAMPORTS_PER_QUOTE_UNIT)
        .ok_or(EqualStartError::Overflow)?;
    let min_out = u64::try_from(min_out).map_err(|_| EqualStartError::Overflow)?;
    Ok(min_out.max(1))
}

fn token_amount(account: &UncheckedAccount) -> Result<u64> {
    let data = account.try_borrow_data()?;
    // SPL token account: mint(32) owner(32) amount(8).
    require!(data.len() >= 72, EqualStartError::VaultShortfall);
    Ok(dbc::read_u64(&data, 64))
}

fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let new_from = from.lamports().checked_sub(amount).ok_or(EqualStartError::Overflow)?;
    let new_to = to.lamports().checked_add(amount).ok_or(EqualStartError::Overflow)?;
    **from.try_borrow_mut_lamports()? = new_from;
    **to.try_borrow_mut_lamports()? = new_to;
    Ok(())
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

/// Reject DBC configs whose first-swap behaviour is incompatible with a CPI buy,
/// whose opening fee exceeds the committed ceiling, or whose curve the full
/// batch could complete (the buy must stay a plain curve swap).
fn validate_dbc_config(config: &UncheckedAccount, terms: &BatchTerms) -> Result<()> {
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
    let collect_fee_mode = data[dbc::CONFIG_COLLECT_FEE_MODE_OFFSET];
    require!(
        collect_fee_mode == dbc::COLLECT_FEE_MODE_QUOTE || collect_fee_mode == dbc::COLLECT_FEE_MODE_OUTPUT,
        EqualStartError::InvalidDbcConfig
    );
    // Every DBC base-fee schedule starts at its cliff fee and only decreases, and
    // the pool activates in the settling instruction, so the cliff fee is the
    // base fee the batch pays. Dynamic fee is re-checked after the swap.
    let cliff = dbc::read_u64(&data, dbc::CONFIG_CLIFF_FEE_NUMERATOR_OFFSET) as u128;
    require!(
        cliff * BPS_DENOMINATOR <= u128::from(terms.max_opening_fee_bps) * dbc::FEE_DENOMINATOR,
        EqualStartError::OpeningFeeTooHigh
    );
    require!(
        terms.max_pool_quote_in < dbc::read_u64(&data, dbc::CONFIG_MIGRATION_QUOTE_THRESHOLD_OFFSET),
        EqualStartError::BadTerms
    );
    Ok(())
}

/// The pool DBC just created must belong to the committed config and base mint,
/// use the vaults we pass to the swap, and show no prior trade.
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

/// Measure the fee DBC actually charged on the batch buy from the pool's fee
/// counters (all zero before the swap, since the pool was created in this
/// instruction) and enforce the committed ceiling. Returns the fee amount.
fn verify_opening_fee(
    pool: &UncheckedAccount,
    config: &UncheckedAccount,
    batch: &Batch,
    quote_spent: u64,
    base_received: u64,
) -> Result<u64> {
    let collect_fee_mode = config.try_borrow_data()?[dbc::CONFIG_COLLECT_FEE_MODE_OFFSET];
    let data = pool.try_borrow_data()?;
    let (fee, gross) = if collect_fee_mode == dbc::COLLECT_FEE_MODE_QUOTE {
        let fee = (dbc::read_u64(&data, dbc::POOL_TOTAL_TRADING_QUOTE_FEE_OFFSET) as u128)
            + (dbc::read_u64(&data, dbc::POOL_TOTAL_PROTOCOL_QUOTE_FEE_OFFSET) as u128);
        (fee, quote_spent as u128)
    } else {
        let fee = (dbc::read_u64(&data, dbc::POOL_TOTAL_TRADING_BASE_FEE_OFFSET) as u128)
            + (dbc::read_u64(&data, dbc::POOL_TOTAL_PROTOCOL_BASE_FEE_OFFSET) as u128);
        (fee, fee + base_received as u128)
    };
    require!(
        fee.checked_mul(BPS_DENOMINATOR).ok_or(EqualStartError::Overflow)?
            <= gross.checked_mul(u128::from(batch.max_opening_fee_bps)).ok_or(EqualStartError::Overflow)?,
        EqualStartError::OpeningFeeTooHigh
    );
    Ok(u64::try_from(fee).map_err(|_| EqualStartError::Overflow)?)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BatchTerms {
    pub launch_id: u64,
    pub closes_at: i64,
    pub expires_at: i64,
    pub per_wallet_cap: u64,
    pub min_raise: u64,
    pub max_pool_quote_in: u64,
    /// Minimum average price: base raw units per 1 SOL of batch quote (fees included).
    pub min_base_per_sol: u64,
    /// Ceiling on the DBC fee charged on the batch buy, in basis points.
    pub max_opening_fee_bps: u16,
    /// Lamports escrowed from the creator; paid to whoever settles, else back to the creator.
    pub settler_bounty: u64,
    pub token_name: String,
    pub token_symbol: String,
    pub token_uri: String,
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
    pub min_base_per_sol: u64,
    pub max_opening_fee_bps: u16,
    pub settler_bounty: u64,
    #[max_len(MAX_NAME_LEN)]
    pub token_name: String,
    #[max_len(MAX_SYMBOL_LEN)]
    pub token_symbol: String,
    #[max_len(MAX_URI_LEN)]
    pub token_uri: String,
    pub phase: Phase,
    pub total_quote: u64,
    pub quote_spent: u64,
    pub base_received: u64,
    pub total_claimed: u64,
    pub participants_count: u32,
    pub claimed_count: u32,
    pub bump: u8,
    pub mint_bump: u8,
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
    pub batch: Box<Account<'info, Batch>>,
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
    pub batch: Box<Account<'info, Batch>>,
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
    pub batch: Box<Account<'info, Batch>>,
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
pub struct Settle<'info> {
    /// Anyone. Pays the account rent and DBC pool-creation fee, receives the
    /// settler bounty, and gains no rights over the batch or its funds.
    #[account(mut)]
    pub settler: Signer<'info>,
    #[account(mut)]
    pub batch: Box<Account<'info, Batch>>,
    /// CHECK: the committed creator; receives the DBC pool-creator role. Need not sign.
    #[account(address = batch.creator)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, address = batch.quote_vault)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: batch ATA for the base mint, created in `settle`.
    #[account(mut, address = batch.base_vault)]
    pub base_vault: UncheckedAccount<'info>,
    /// CHECK: batch-PDA base mint, created by DBC in `settle`.
    #[account(mut, address = batch.base_mint)]
    pub base_mint: UncheckedAccount<'info>,
    #[account(address = batch.quote_mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    /// CHECK: committed DBC pool PDA, created by DBC in `settle`; contents checked afterwards.
    #[account(mut, address = batch.pool)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: committed config.
    #[account(address = batch.dbc_config)]
    pub dbc_config: UncheckedAccount<'info>,
    /// CHECK: DBC derives and `init`s it (seeds checked by DBC); must match pool state.
    #[account(mut)]
    pub dbc_base_vault: UncheckedAccount<'info>,
    /// CHECK: DBC derives and `init`s it (seeds checked by DBC); must match pool state.
    #[account(mut)]
    pub dbc_quote_vault: UncheckedAccount<'info>,
    /// CHECK: Metaplex metadata PDA of the base mint; derived and checked by Metaplex.
    #[account(mut)]
    pub mint_metadata: UncheckedAccount<'info>,
    /// CHECK: fixed Metaplex program id.
    #[account(address = dbc::METADATA_PROGRAM_ID)]
    pub metadata_program: UncheckedAccount<'info>,
    /// CHECK: fixed DBC PDA.
    #[account(address = dbc::POOL_AUTHORITY)]
    pub dbc_pool_authority: UncheckedAccount<'info>,
    /// CHECK: fixed DBC PDA.
    #[account(address = dbc::EVENT_AUTHORITY)]
    pub dbc_event_authority: UncheckedAccount<'info>,
    /// CHECK: fixed DBC program id.
    #[account(address = dbc::PROGRAM_ID)]
    pub dbc_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(mut)]
    pub batch: Box<Account<'info, Batch>>,
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
    pub batch: Box<Account<'info, Batch>>,
    /// CHECK: the committed creator; receives the unused settler bounty. Need not sign.
    #[account(mut, address = batch.creator)]
    pub creator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    pub participant: Signer<'info>,
    pub batch: Box<Account<'info, Batch>>,
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
    pub batch: Box<Account<'info, Batch>>,
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
    #[msg("DBC fee on the opening buy exceeds the committed ceiling")]
    OpeningFeeTooHigh,
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
