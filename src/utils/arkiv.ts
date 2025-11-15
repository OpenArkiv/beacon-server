import * as arkiv from '@arkiv-network/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { http } from 'viem';
import { stringToPayload } from '@arkiv-network/sdk/utils';
import type { DeviceEntity } from '../types/index.js';
import type { WalletClient, PublicClient } from '@arkiv-network/sdk';

/**
 * Create Arkiv wallet client from private key
 */
export function createArkivWalletClient(privateKey: string): WalletClient {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  
  return arkiv.createWalletClient({
    chain: arkiv.mendoza,
    transport: arkiv.http(process.env.ARKIV_RPC_URL || 'https://mendoza.hoodi.arkiv.network/rpc'),
    account,
  });
}

/**
 * Get wallet address from private key
 */
export function getWalletAddressFromPrivateKey(privateKey: string): string {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return account.address;
}

/**
 * Create Arkiv public client
 */
export function createArkivPublicClient(): PublicClient {
  return arkiv.createPublicClient({
    chain: arkiv.mendoza,
    transport: http(process.env.ARKIV_RPC_URL || 'https://mendoza.hoodi.arkiv.network/rpc'),
  });
}

/**
 * Upload device entity to Arkiv network
 */
export async function uploadEntityToArkiv(
  walletClient: WalletClient,
  entity: DeviceEntity,
  ipfsHash?: string
): Promise<{ entityKey: string; txHash: string }> {
  // Prepare the payload - include IPFS hash if provided
  const payloadData = ipfsHash 
    ? JSON.stringify({ ...entity, ipfsHash })
    : JSON.stringify(entity);
  
  const payload = stringToPayload(payloadData);
  
  // Create entity with attributes
  const attributes: Array<{ key: string; value: string }> = [
    { key: 'type', value: 'device-beacon' },
    { key: 'devicePub', value: entity.devicePub },
    { key: 'nodeId', value: entity.nodeId },
  ];
  
  if (entity.location) {
    attributes.push(
      { key: 'lat', value: entity.location.lat.toString() },
      { key: 'lon', value: entity.location.lon.toString() }
    );
  }
  
  if (entity.tags && entity.tags.length > 0) {
    attributes.push({ key: 'tags', value: entity.tags.join(',') });
  }
  
  if (ipfsHash) {
    attributes.push({ key: 'ipfsHash', value: ipfsHash });
  }
  
  // Create entity on Arkiv (expires in 1 year = ~31536000 seconds)
  const { entityKey, txHash } = await walletClient.createEntity({
    payload,
    contentType: 'application/json',
    attributes,
    expiresIn: 31536000, // 1 year in seconds
  });
  
  return { entityKey, txHash };
}

