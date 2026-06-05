import { ethers } from 'ethers';
import { braga } from '@arkiv-network/sdk/chains';
import { logger } from '../index.js';

/**
 * Funder wallet: a single, pre-funded wallet that tops up the per-device
 * derived wallets when they run out of gas. Each upload pays from a wallet
 * derived deterministically from the device identifier; those wallets start
 * empty, so the first upload (and any upload after a wallet drains) fails with
 * "insufficient funds". When that happens the upload handler asks this funder
 * to send a small amount of the native token, then retries the transaction.
 *
 * Configure via env:
 *   FUNDER_PRIVATE_KEY   0x-prefixed key of the pre-funded wallet (required to enable)
 *   FUNDER_FUND_AMOUNT   native-token amount to send per top-up (default 0.05)
 */

const RPC_URL = () =>
  process.env.ARKIV_RPC_URL || 'https://braga.hoodi.arkiv.network/rpc';

/** Amount of native token sent to a device wallet on each top-up. */
const FUND_AMOUNT = () => process.env.FUNDER_FUND_AMOUNT || '0.05';

/** True when a funder key is configured. */
export function isFunderEnabled(): boolean {
  return !!process.env.FUNDER_PRIVATE_KEY;
}

function getFunderWallet(): ethers.Wallet {
  const key = process.env.FUNDER_PRIVATE_KEY;
  if (!key) {
    throw new Error('FUNDER_PRIVATE_KEY is not set');
  }
  // Pin the chainId so ethers doesn't have to round-trip eth_chainId and so
  // replay protection uses the right network.
  const provider = new ethers.JsonRpcProvider(RPC_URL(), {
    chainId: braga.id,
    name: braga.network,
  });
  return new ethers.Wallet(key, provider);
}

/** Address of the configured funder wallet, or null if none is set. */
export function getFunderAddress(): string | null {
  const key = process.env.FUNDER_PRIVATE_KEY;
  if (!key) return null;
  return new ethers.Wallet(key).address;
}

/**
 * Send native tokens from the funder wallet to `targetAddress` and wait for the
 * transfer to be mined. Returns the funding transaction hash.
 *
 * Throws if no funder is configured or if the funder itself is out of funds —
 * callers should surface that clearly since it means the whole top-up pool is
 * empty and needs refilling from the faucet.
 */
export async function fundWallet(targetAddress: string): Promise<string> {
  const funder = getFunderWallet();
  const amount = ethers.parseEther(FUND_AMOUNT());

  const funderAddress = funder.address;
  const funderBalance = await funder.provider!.getBalance(funderAddress);

  logger.info('Funding device wallet from funder', {
    funderAddress,
    targetAddress,
    amount: FUND_AMOUNT(),
    funderBalance: ethers.formatEther(funderBalance),
  });

  if (funderBalance < amount) {
    throw new Error(
      `Funder wallet ${funderAddress} is out of funds ` +
        `(balance ${ethers.formatEther(funderBalance)}, needs ${FUND_AMOUNT()}). ` +
        `Refill it from the faucet.`
    );
  }

  const tx = await funder.sendTransaction({
    to: targetAddress,
    value: amount,
  });

  logger.info('Funding transaction sent, awaiting confirmation', {
    funderAddress,
    targetAddress,
    fundingTxHash: tx.hash,
  });

  await tx.wait();

  logger.info('Device wallet funded successfully', {
    funderAddress,
    targetAddress,
    fundingTxHash: tx.hash,
    amount: FUND_AMOUNT(),
  });

  return tx.hash;
}
