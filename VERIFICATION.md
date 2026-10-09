# EqualStart: public devnet verification record

Generated 2026-10-09T06:19:42.294Z from `evidence/devnet-run.json` (run 2026-10-09T06:12:18.021Z → 2026-10-09T06:19:13.551Z).
Every link below opens the transaction or account on the public Solana Explorer.

## Deployment

| | |
|---|---|
| EqualStart program | [`6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j`](https://explorer.solana.com/address/6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j?cluster=devnet) |
| Meteora DBC program (Meteora's live deployment) | [`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`](https://explorer.solana.com/address/dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN?cluster=devnet) |
| Local build sha256 (`onchain/target/deploy/equalstart.so`) | `75df8dc1d4b83db1a84074ead3c951c11ff632d06c9477cc7de95ffb19cb01d3` |
| Deployed program sha256 (`solana program dump`) | `75df8dc1d4b83db1a84074ead3c951c11ff632d06c9477cc7de95ffb19cb01d3` (matches the local build) |
| DBC SDK / IDL / Anchor / validator | 1.5.13 / 0.2.1 / 1.2.1 / 4.4.0-beta.0 |

```
Program Id: 6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: Cw6ugALnPJC7t7SyMge2DR74U6MAV3tWXBRQvThGDA34
Authority: HULHgNRpDLF9u7ZpDwVgDDWDj3iu6VubeL5vGP5jwgEz
Last Deployed In Slot: 509082365
Data Length: 346032 (0x547b0) bytes
Balance: 1.7587214 SOL
```

The upgrade authority is a throwaway deployer key. See "Limitations".

## The opening batch: deposits → one-instruction settlement → independent claims

Batch (escrow) [`8F8fx1WzLjdcXr1xYnp6BeC3o67zSKsgM8LPoknBaGQH`](https://explorer.solana.com/address/8F8fx1WzLjdcXr1xYnp6BeC3o67zSKsgM8LPoknBaGQH?cluster=devnet) · pool [`6dkC8V4dgCnzbGPv2h3LaYuMNpA4C199Y1hPbMJLiQL9`](https://explorer.solana.com/address/6dkC8V4dgCnzbGPv2h3LaYuMNpA4C199Y1hPbMJLiQL9?cluster=devnet) · token mint [`GHAR3Nrqm4MqX7zZ7vBRgPtyj75eYkhhXVoDsUP6B658`](https://explorer.solana.com/address/GHAR3Nrqm4MqX7zZ7vBRgPtyj75eYkhhXVoDsUP6B658?cluster=devnet)

| Step | Result | Transaction |
|---|---|---|
| initialize_batch main | ✅ succeeded | [4eiaBFnDpoeZRLuX…](https://explorer.solana.com/tx/4eiaBFnDpoeZRLuXFY3qR49R7wcn4ZgfUiuws8kvAatsbSYHz8gJfqyR7tqnwaNJxwjspg52UaJuRyzPqE1WDidm?cluster=devnet) |
| deposit alice 0.15 (main) | ✅ succeeded | [ARZWMsNj5gbvKz95…](https://explorer.solana.com/tx/ARZWMsNj5gbvKz95j2GRfykV1k9XvEaage53Hfdp6H3bjJHXJUdugfk2KQurAi8DHwr8ahBDkMjUAAkv3P4pTJx?cluster=devnet) |
| withdraw alice 0.05 before close (main) | ✅ succeeded | [49YjikfaipYQhMkP…](https://explorer.solana.com/tx/49YjikfaipYQhMkP4PdFHLvTnJCXqPBtrDCzNQX77Yo6twdB5JaXawb73BRyAzoRiK61ZZtJn4e6mREQB2AHQRd5?cluster=devnet) |
| deposit bob 0.2 (main) | ✅ succeeded | [2q9tUr4jGb6MSfyW…](https://explorer.solana.com/tx/2q9tUr4jGb6MSfyWU1i5LsSrYtx4UawL2YjrHCH2e3Jx6uFpsEYf7wexQ8thDn2Hqjy1sfUiqktjMsuBZb6qKocp?cluster=devnet) |
| deposit carol 0.3 (main) | ✅ succeeded | [4v6oRG9P1ZYzkPE3…](https://explorer.solana.com/tx/4v6oRG9P1ZYzkPE3gX3H8oU6KNWM6jutYndkdQwEWrPs8mfMc4Qmy7qZouxUYq19iHb42z9MBHuQW8gQx3so3fri?cluster=devnet) |
| SETTLEMENT settle by eve (permissionless) | ✅ succeeded | [3mPebdq9aesrtS28…](https://explorer.solana.com/tx/3mPebdq9aesrtS28sEaRJqXjMwM54BkXbotfGugknUVVQUwUdo46s2iXtubUWojGGy5VRaLnJgb2wccHSbatkN7t?cluster=devnet) |
| claim carol | ✅ succeeded | [jjQMVsuWUiu7vkEK…](https://explorer.solana.com/tx/jjQMVsuWUiu7vkEK3QGka5amNuvJUzMiaeY5QPPBu82CzbWudvMeySkwvaDeCmTGsKjqrHVpgV2QcTuZ29f3van?cluster=devnet) |
| claim alice | ✅ succeeded | [5yLgdMDHoNpdALHR…](https://explorer.solana.com/tx/5yLgdMDHoNpdALHRAPXtu4T2Y4xCpdBaxruAtdWBV6pBbVUJEwTpKxa3ZyGes4py7yhZYa9GZfnAMSxvYJwmj9AK?cluster=devnet) |
| claim bob | ✅ succeeded | [2HoyxxUkiatcvpK1…](https://explorer.solana.com/tx/2HoyxxUkiatcvpK1QersHhHcLh9X1iVs99jwvrnLg9pRDNmaLKm3R9rY7UfnTu3a8riisnHACLmsTXD89zgG3SMW?cluster=devnet) |
| burn_dust (permissionless, after all claims) | ✅ succeeded | [4jZ8Lw7JMerMC2bw…](https://explorer.solana.com/tx/4jZ8Lw7JMerMC2bwi7qBejqrYuKFvTNsQwtMy4AQH7yVct4Jg8iWzyNfJTsg2uA1WkizusYdpyYEftwD3wTBdmkK?cluster=devnet) |

**What to check in the settlement transaction** [3mPebdq9aesrtS28…](https://explorer.solana.com/tx/3mPebdq9aesrtS28sEaRJqXjMwM54BkXbotfGugknUVVQUwUdo46s2iXtubUWojGGy5VRaLnJgb2wccHSbatkN7t?cluster=devnet):
- The signer is `eve` ([`CHNW5bxm3fT3kLBHwGu3dZzn7pzjevgwAnt94j25A4Yk`](https://explorer.solana.com/address/CHNW5bxm3fT3kLBHwGu3dZzn7pzjevgwAnt94j25A4Yk?cluster=devnet)), a wallet with no role in the launch. The creator ([`CiYuBF9qqVpan75d7oPmCkTUMrbfJBqcDYbYJFsW9foR`](https://explorer.solana.com/address/CiYuBF9qqVpan75d7oPmCkTUMrbfJBqcDYbYJFsW9foR?cluster=devnet)) signs nothing after `initialize_batch`.
- EqualStart is the only top-level program. The DBC instructions `InitializeVirtualPoolWithSplToken`, `Swap2` and `TransferPoolCreator` all appear as inner instructions at depth 2.
- Log line: `EqualStart settled: quote_spent=600000000 base_received=19453340776307 min_base_out=18000000000000 opening_fee=6000000`.
- The pool's transaction history has no successful transaction before this one.

Claims (1:2:3 deposits): Alice 3242223462717 · Bob 6484446925435 · Carol 9726670388153 raw units. Each equals floor(19453340776307 × deposit ÷ 600000000).

## Creator abandonment and refunds

| Step | Result | Transaction |
|---|---|---|
| initialize_batch abandoned | ✅ succeeded | [2AkvbTGfJjzJ1CpD…](https://explorer.solana.com/tx/2AkvbTGfJjzJ1CpDDjFhjgC7EFdfqbTBHhAR4CkfTV7QsaevDbj5jJCmoqXx4SLWAEWd23HGTJvYNKtF2NgBwDKG?cluster=devnet) |
| initialize_batch underfunded (min raise 0.5 SOL) | ✅ succeeded | [2jZddXr1wbGKHzd8…](https://explorer.solana.com/tx/2jZddXr1wbGKHzd88iPtLKe4EzzLFa1LMkEZUYDVvxb4WWomvGwZ4QuhR3DwNKmRhVsPNDMTbso1JcQu9t1m1HQS?cluster=devnet) |
| deposit alice 0.05 (abandoned) | ✅ succeeded | [5uFifFP4etYG4HsF…](https://explorer.solana.com/tx/5uFifFP4etYG4HsFChGGVVhY1YGNUUkdWm43GwbrSQKbZPwAqf1882Ju4RHtE75BbHZwkSN8YKHqhqkNTxYQLnF1?cluster=devnet) |
| deposit bob 0.1 (abandoned) | ✅ succeeded | [Y5dDDCBZVYk8UJax…](https://explorer.solana.com/tx/Y5dDDCBZVYk8UJaxJwvknzMdiBpNVRuFZqQGbzgS7DkwzgzQxRCbcgAGnMqYSudGjQwh5GLQ6VD4es1hpobL9Uo?cluster=devnet) |
| deposit carol 0.15 (abandoned) | ✅ succeeded | [4zrksYLtuF7rQJ2j…](https://explorer.solana.com/tx/4zrksYLtuF7rQJ2juYqgCVv8Vakf9jf5wmZHrNZPCt3eAPJejVnNaMbKLEuMd96Q6D1M3h4HXp9jLt4CJdc599gy?cluster=devnet) |
| deposit bob 0.1 (underfunded) | ✅ succeeded | [CmwStK2pG7FrQ3e1…](https://explorer.solana.com/tx/CmwStK2pG7FrQ3e1vpt8H4WuYD5w47DiFiMY7cWwPvtfUZMgVSkKbsZHD61p4ExBjZNrMNRLYnypE2A616iRGzK?cluster=devnet) |
| ATTACK refund before cancellation | ❌ rejected: NotCancelled | [4fiScSRtoB5fAfaV…](https://explorer.solana.com/tx/4fiScSRtoB5fAfaVreUcPzcjXDCuhSano8Q2vaex53QxXaPpUqL1DFcCWfeXtbHRcLNVcz99Vnrv7RDQTkNcYNPx?cluster=devnet) |
| ATTACK cancel_expired before expiry | ❌ rejected: NotExpired | [4u8MTwpvJVwAMNLC…](https://explorer.solana.com/tx/4u8MTwpvJVwAMNLCi4twwE3UchauLDNuytHgPBqHpWBbA16VgxThK732GEsMjftteHPdPBpF5DGSBc2gpstxUxfo?cluster=devnet) |
| ATTACK settle underfunded batch (min raise not met) | ❌ rejected: MinRaiseNotMet | [4QkgamSmBiEVFUyy…](https://explorer.solana.com/tx/4QkgamSmBiEVFUyy5kQYKK2v58jYnRCLCmfKQ4tMRz1dzurF3Y8Ld24ZCirvDtXp1Lrfn7kbPfTGkLnm2qt43bh?cluster=devnet) |
| ATTACK cancel_expired sending bounty to eve | ❌ rejected: ConstraintAddress | [2TZYxYASuNaqMgc5…](https://explorer.solana.com/tx/2TZYxYASuNaqMgc5aDabFHA6bDu17dsZj4V7Vj81wKVRJH2yNmoAEQKErinEqoXuHhTtxtstfk8cY6CuSmcuXWjZ?cluster=devnet) |
| cancel_expired abandoned by eve (permissionless) | ✅ succeeded | [2tFy9bvbrZyN3Dvx…](https://explorer.solana.com/tx/2tFy9bvbrZyN3DvxiprPs8prNq9FFy6VDCdguu1wpp7SPzRHeAKVEqJkHNPK5s7DRXxVPUKxP5PiqroCEKjMofzH?cluster=devnet) |
| ATTACK cancel_expired twice | ❌ rejected: NotOpen | [37nPG9VHJD97nEgM…](https://explorer.solana.com/tx/37nPG9VHJD97nEgMHnhc1MauA1MvigzUMQMv1oELjpbBcB2AfVJ4rfDCRaZJFrBKY4pDTD19eT7K1oyPp3aJyPRQ?cluster=devnet) |
| ATTACK eve refunds alice's deposit to eve | ❌ rejected: ConstraintSeeds | [SevK3oUXxnz1Ntxb…](https://explorer.solana.com/tx/SevK3oUXxnz1NtxbJKpPoaStSmoVX9WvmYqpKn1hd6exF634yT4y3bdbcMQGf6swGsan6s74jka1Q1MhgCz2WRr?cluster=devnet) |
| ATTACK alice refunds into eve's token account | ❌ rejected: ConstraintTokenOwner | [3JViqc5QXewyYPEk…](https://explorer.solana.com/tx/3JViqc5QXewyYPEkw9S2KWi9nkwm2H5994fTFp98EdxHff8bch7TvvqE3n4YF8Sg9oK1cDcNKXdS43SmspWrioKV?cluster=devnet) |
| refund bob | ✅ succeeded | [XaE4rmonGkqzDwCn…](https://explorer.solana.com/tx/XaE4rmonGkqzDwCnv7k2asUj3BKphcuGxiVTUw3yE4Z1AgTLf3P4zaNDxLWhLBmVTFPEGXJgKdodcodtL81VRtZ?cluster=devnet) |
| refund alice | ✅ succeeded | [2yM3nncPUHiuofcb…](https://explorer.solana.com/tx/2yM3nncPUHiuofcbkbGiNisHCq9NXWG5oYeEEmPRseFRX2mXGYfLN8H3YqV5F9BtprHyZJmNXqUoJFAbREHnWJv5?cluster=devnet) |
| refund carol | ✅ succeeded | [2LJhCig3hB1F8hwa…](https://explorer.solana.com/tx/2LJhCig3hB1F8hwaK2RFezbaiC18kDkN4XF6smCN4DMxYxxwkKLnGKrzYKZhYwEUyDcLyw6S8kCMfjheTenC2KFX?cluster=devnet) |
| ATTACK bob double-refund | ❌ rejected: AlreadyRefunded | [4JB9YtomxKcYQSvK…](https://explorer.solana.com/tx/4JB9YtomxKcYQSvKAUqZaTeKvRHaHNFX1mVPS6g9W85hQi9SJLn8WGT563S4nuPecMoBJw57pnAJhPBXo49L6Gn4?cluster=devnet) |
| cancel_expired underfunded by eve | ✅ succeeded | [4F622BWdqenYFWLV…](https://explorer.solana.com/tx/4F622BWdqenYFWLVLtF6zX16hJXCJdyLPUsaGSC85kKXfJn5QPQP9NTx34nknCjRgQz7Vxg5wbPRo41igz1wcAKW?cluster=devnet) |
| refund bob (underfunded) | ✅ succeeded | [4SVc8MSX8Aqj86zq…](https://explorer.solana.com/tx/4SVc8MSX8Aqj86zqkRgcPC9UPX5qSz9nGhThyArbaHci5f3cbWxttoRe5n8fYa1fL7rVf2G9DrrUcPFH8xUJxZ8q?cluster=devnet) |

## Immutable commitments, invalid configs, attacks

Each of these was submitted on purpose and rejected on-chain. The failed transactions are visible on the explorer.

| Attempt | Result | Transaction |
|---|---|---|
| ATTACK re-initialize main batch with new terms | ❌ rejected: already in use | [4ZMSjXoYsCyj1tWa…](https://explorer.solana.com/tx/4ZMSjXoYsCyj1tWapzB4t3RDncPUEMvuSuR1gGt8aWS7zyBWEkMPXvB3tKuRhoEHSnBKqrqq96z3mqR4tE5BUrvE?cluster=devnet) |
| ATTACK initialize_batch with non-DBC config | ❌ rejected: InvalidDbcConfig | [43kmc6uFCxhXj6QK…](https://explorer.solana.com/tx/43kmc6uFCxhXj6QKNcban3WQaJwpF2U8eSe3hJ1M1nXVrNLgKMYVuGYmFWZZ5x1V5mdexsrkcEFtVrBqhpDYMKAe?cluster=devnet) |
| ATTACK initialize_batch with first-swap-min-fee config | ❌ rejected: InvalidDbcConfig | [5nqJBcr4WWEEZvny…](https://explorer.solana.com/tx/5nqJBcr4WWEEZvnyv68dxfMT1wtAwuTL3MX6Ma4mJuB45ny4ozx57PLFy5suMNksHeiZ2dfT9vouWLiN9vpUczho?cluster=devnet) |
| ATTACK initialize_batch: config opening fee 5% > committed 1% | ❌ rejected: OpeningFeeTooHigh | [7DeoAmtYp24ggcs4…](https://explorer.solana.com/tx/7DeoAmtYp24ggcs4WpFx7xXh9J74bTjzesDqecdWQTrEJXRQZRYfqJMTbLiK5WPjJDLvaXUHVxsaUHiqQqZs4qt?cluster=devnet) |
| ATTACK initialize_batch with max_pool_quote_in >= DBC migration threshold | ❌ rejected: BadTerms | [3u3PRa2cqH6w7M1N…](https://explorer.solana.com/tx/3u3PRa2cqH6w7M1NNYPevrMqci21rMqnupnCh6qjLaXcaH5Fq7eXnRaVFmTzqLweKUGT1ZY3WKCgLiP4ZpvCTPrp?cluster=devnet) |
| ATTACK initialize_batch: min_base_per_sol overflows u64 at max raise | ❌ rejected: Overflow | [pcJsywZH6757aqsu…](https://explorer.solana.com/tx/pcJsywZH6757aqsu7fKMGyTMRsgw55zowmNTtA1TGGLGHN18mWwGkW2e4aeCGXP5eTZM4oHK1WABpG8Po5HvcDU?cluster=devnet) |
| ATTACK initialize_batch with expiry before close | ❌ rejected: BadDeadlines | [2tUbcLhhSkyRdSbo…](https://explorer.solana.com/tx/2tUbcLhhSkyRdSboY77kmFygJG1xWvuV4RirHuHN4au4JUz2ojoSj9Nqiw9KhGgD6qRxKXcYLdbqQ5PrJYXKpDNV?cluster=devnet) |
| ATTACK refund before cancellation | ❌ rejected: NotCancelled | [4fiScSRtoB5fAfaV…](https://explorer.solana.com/tx/4fiScSRtoB5fAfaVreUcPzcjXDCuhSano8Q2vaex53QxXaPpUqL1DFcCWfeXtbHRcLNVcz99Vnrv7RDQTkNcYNPx?cluster=devnet) |
| ATTACK cancel_expired before expiry | ❌ rejected: NotExpired | [4u8MTwpvJVwAMNLC…](https://explorer.solana.com/tx/4u8MTwpvJVwAMNLCi4twwE3UchauLDNuytHgPBqHpWBbA16VgxThK732GEsMjftteHPdPBpF5DGSBc2gpstxUxfo?cluster=devnet) |
| ATTACK carol exceeds per-wallet cap | ❌ rejected: WalletCapExceeded | [549oVSg8xaJqHFiT…](https://explorer.solana.com/tx/549oVSg8xaJqHFiTz7mTuW4GqAUVvdBCJAgu3khpmHrJ5u73mcpHeoBuxA4g61JW9HoS5yNWi6iUaN8gX4t5vF9J?cluster=devnet) |
| ATTACK eve withdraws from alice's contribution | ❌ rejected: ConstraintSeeds | [Aaju15rnzGLPxJxz…](https://explorer.solana.com/tx/Aaju15rnzGLPxJxz2oU8npVe5YUj36itiSmcqd2qJF1gGXtfJcdePideoihuVGi9KBwLH3A9iKNJMP7UFtXNFzX?cluster=devnet) |
| ATTACK creator SPL-transfers out of PDA quote vault | ❌ rejected: owner does not match | [4KZyKXjYumDwA5yh…](https://explorer.solana.com/tx/4KZyKXjYumDwA5yhVAh5VYdWDTnxKvvXh9Y8NQqzrsQ3YL1EFL7fhpECkTKh9sL5KiznBUXU1XU3h4JjayJgF6M5?cluster=devnet) |
| ATTACK settle before closes_at | ❌ rejected: NotInSettlementWindow | [6zH5DtLuq5az6ZcU…](https://explorer.solana.com/tx/6zH5DtLuq5az6ZcUqgdgTP1xJeXhGjsS8XPswJjF6RnRuDSEEJofJASJVupZEywsnMn9Ssx51KGdmMhzW4tBQZs?cluster=devnet) |
| ATTACK deposit after closes_at | ❌ rejected: DepositClosed | [8CyN4P55cMVgHxLp…](https://explorer.solana.com/tx/8CyN4P55cMVgHxLpSkvBQDuWx3vPmCwpcZvuzvPWdavLCw5JeWsaD7PoYVGDQdM7gDksS16r7Q51h24V7QtAF83?cluster=devnet) |
| ATTACK eve creates the committed DBC pool directly (front-run) | ❌ rejected: unauthorized signer | [5VezLppoGWmckmXs…](https://explorer.solana.com/tx/5VezLppoGWmckmXsdJMS4fSCirvQRu421ZEFVXTBVnvLRXqWqzoC2jfYoL4dpyMJcGSpMBd11dCjAJGxZqKJMLq5?cluster=devnet) |
| GRIEF eve pre-funds mint, pool, vaults and metadata addresses | ✅ succeeded | [gHYUsgQ3gBYJP452…](https://explorer.solana.com/tx/gHYUsgQ3gBYJP452iMezwFQhbG5vbYqPoao6TwZUePcMo5SFDYuAnpEb2gqfa4d4e99XYHCBRs7NaHXnEfooouw?cluster=devnet) |
| ATTACK settle naming eve as the creator (steal DBC creator role) | ❌ rejected: ConstraintAddress | [2mE6CiS9oGGqNFbb…](https://explorer.solana.com/tx/2mE6CiS9oGGqNFbborfgfnSs3RshYDriuhpJeR3kLPJTcwwx6ti1WjMs2X9aUXckx2mvdupmqEsfAZS6zWqKD1Uc?cluster=devnet) |
| ATTACK settle routing the buy into eve's token account | ❌ rejected: ConstraintAddress | [2EuG4XpFF6JQXqPw…](https://explorer.solana.com/tx/2EuG4XpFF6JQXqPwoNUvALtayXrBSYJQ1CaLUSf5rG3DzdSfKtzQuhfWWW76vSRd8f74LVG2ZVRuJnHoVQcbVuCX?cluster=devnet) |
| ATTACK settle underfunded batch (min raise not met) | ❌ rejected: MinRaiseNotMet | [4QkgamSmBiEVFUyy…](https://explorer.solana.com/tx/4QkgamSmBiEVFUyy5kQYKK2v58jYnRCLCmfKQ4tMRz1dzurF3Y8Ld24ZCirvDtXp1Lrfn7kbPfTGkLnm2qt43bh?cluster=devnet) |
| settle slippage batch | ❌ rejected: ExceededSlippage | [5VAuNp7yHk2F8daL…](https://explorer.solana.com/tx/5VAuNp7yHk2F8daLkXDEXE5jiHN12KFskEMECtvg6hj7SnVpZivzVMJYeAmn4CmFEJEdovRwSVnf9P3RYWxAm8a1?cluster=devnet) |
| ATTACK replay settle | ❌ rejected: NotOpen | [a55yHogzXFrm3dSV…](https://explorer.solana.com/tx/a55yHogzXFrm3dSVFQBhxXXf3aaVT6rr8nMhFX8XCcHCAL8ti225VfgJKqFAZjd8TUuokVZ2pKrbV7PbU4zTx1K?cluster=devnet) |
| ATTACK creator SPL-transfers out of PDA base vault | ❌ rejected: owner does not match | [4f6tbTUFeXmNt6ZJ…](https://explorer.solana.com/tx/4f6tbTUFeXmNt6ZJBk69AhDFv4Mca5p6MYBZJDC9jHFpUmidAwo4K7wJRKWGS5c2tQ6PdzWHnNQCb7753RmSZBen?cluster=devnet) |
| ATTACK eve claims alice's share | ❌ rejected: ConstraintSeeds | [4rHJBZD1w28XnEah…](https://explorer.solana.com/tx/4rHJBZD1w28XnEahUYwxFzRMUi1TLoPs2Bo4Ebpa1dqxt8RQQCLTYFNwuyhRoX7jihEfAnHz56jsSMryjCrNUiFo?cluster=devnet) |
| ATTACK eve claims without contribution | ❌ rejected: AccountNotInitialized | [r4G5CwcLRKo9RqDD…](https://explorer.solana.com/tx/r4G5CwcLRKo9RqDD6mXS3kED3oBGQ5CWA15XbuUPe86nZqtyhLPLdvdvwFeoxmFkP2cQwfVdjvHZFYg1oxLWW2U?cluster=devnet) |
| ATTACK burn_dust before all claims | ❌ rejected: ClaimsOutstanding | [4qt1Bkd1721mpb7T…](https://explorer.solana.com/tx/4qt1Bkd1721mpb7TowUPTqAxndk6BJKU7FcwFm2VyeYpWZ2m3HQpDzLfveDzbJM99qUghuHGriZAk7aZdo5682eX?cluster=devnet) |
| ATTACK alice double-claims | ❌ rejected: AlreadyClaimed | [5YKy4n7HBqodWWp6…](https://explorer.solana.com/tx/5YKy4n7HBqodWWp6wjtf4zachxyUsF7AnXYuSC5aahq2uhZi2xVztmRWfhehnm6Z3YVtjJtCrTiWzxSJMBApdTCp?cluster=devnet) |
| ATTACK settle after expiry | ❌ rejected: NotInSettlementWindow | [4AJ8DCnYgobHErss…](https://explorer.solana.com/tx/4AJ8DCnYgobHErssqknDUJF72efRuyi25eq5JnqMguxw18C46UVBAyAZpaXC2gKZrfwPadTqLdYpWJuQ3dbTgJWT?cluster=devnet) |
| ATTACK cancel_expired sending bounty to eve | ❌ rejected: ConstraintAddress | [2TZYxYASuNaqMgc5…](https://explorer.solana.com/tx/2TZYxYASuNaqMgc5aDabFHA6bDu17dsZj4V7Vj81wKVRJH2yNmoAEQKErinEqoXuHhTtxtstfk8cY6CuSmcuXWjZ?cluster=devnet) |
| ATTACK cancel_expired twice | ❌ rejected: NotOpen | [37nPG9VHJD97nEgM…](https://explorer.solana.com/tx/37nPG9VHJD97nEgMHnhc1MauA1MvigzUMQMv1oELjpbBcB2AfVJ4rfDCRaZJFrBKY4pDTD19eT7K1oyPp3aJyPRQ?cluster=devnet) |
| ATTACK eve refunds alice's deposit to eve | ❌ rejected: ConstraintSeeds | [SevK3oUXxnz1Ntxb…](https://explorer.solana.com/tx/SevK3oUXxnz1NtxbJKpPoaStSmoVX9WvmYqpKn1hd6exF634yT4y3bdbcMQGf6swGsan6s74jka1Q1MhgCz2WRr?cluster=devnet) |
| ATTACK alice refunds into eve's token account | ❌ rejected: ConstraintTokenOwner | [3JViqc5QXewyYPEk…](https://explorer.solana.com/tx/3JViqc5QXewyYPEkw9S2KWi9nkwm2H5994fTFp98EdxHff8bch7TvvqE3n4YF8Sg9oK1cDcNKXdS43SmspWrioKV?cluster=devnet) |
| ATTACK bob double-refund | ❌ rejected: AlreadyRefunded | [4JB9YtomxKcYQSvK…](https://explorer.solana.com/tx/4JB9YtomxKcYQSvKAUqZaTeKvRHaHNFX1mVPS6g9W85hQi9SJLn8WGT563S4nuPecMoBJw57pnAJhPBXo49L6Gn4?cluster=devnet) |

## Reproduce

```bash
git clone <repo> && cd equalstart_spike/onchain && npm install && anchor build
scripts/devnet.sh            # deploys and runs tests/equalstart.ts against live devnet DBC
```
Full logs for every transaction: `evidence/devnet-run.json`.

## Limitations (read before trusting this)

- **Unaudited.** This is a hackathon prototype. It needs an independent security review before any mainnet use.
- **Upgrade authority.** The deployer key can upgrade EqualStart on devnet, which can change everything above. A trustless deployment needs the authority revoked, or held by a disclosed multisig with a timelock.
- **Dependency on Meteora DBC.** EqualStart hard-codes DBC's discriminators, account order and byte offsets from IDL 0.2.1. Meteora can upgrade DBC; a layout change could break or mislead these checks. During settlement, EqualStart lets the escrow's address sign for DBC calls; before/after balance checks limit, but cannot rule out, the damage from a malicious DBC upgrade.
- Further limitations are in `ONCHAIN_RESULTS.md` ("Remaining security concerns").

