// Builds the Meteora DBC config the demo uses: wSOL quote, SPL token, flat fee,
// first-swap-min-fee off. Same parameters as the onchain test suite.
import { Connection, Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurveWithMarketCap,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const DEFAULT_CURVE = { feeBps: 100, initialMarketCapSol: 30, migrationMarketCapSol: 300, totalSupply: 1_000_000_000 };

export async function createDbcConfigIxs(
  connection: Connection,
  owner: PublicKey,
  feeBps = DEFAULT_CURVE.feeBps,
): Promise<{ config: Keypair; ixs: TransactionInstruction[] }> {
  const config = Keypair.generate();
  const curve = buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: 9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: DEFAULT_CURVE.totalSupply,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: feeBps, endingFeeBps: feeBps, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps25,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 50,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    initialMarketCap: DEFAULT_CURVE.initialMarketCapSol,
    migrationMarketCap: DEFAULT_CURVE.migrationMarketCapSol,
  });
  const dbc = new DynamicBondingCurveClient(connection, "confirmed");
  const tx = await dbc.partner.createConfig({
    config: config.publicKey,
    feeClaimer: owner,
    leftoverReceiver: owner,
    quoteMint: NATIVE_MINT,
    payer: owner,
    ...curve,
  });
  return { config, ixs: tx.instructions };
}
