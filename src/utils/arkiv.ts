import { createWalletClient, createPublicClient, http } from '@arkiv-network/sdk';
import { braga } from '@arkiv-network/sdk/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { stringToPayload } from '@arkiv-network/sdk/utils';
import { eq } from '@arkiv-network/sdk/query';
import type { DeviceEntity } from '../types/index.js';
import type {
  WalletArkivClient,
  PublicArkivClient,
  Entity,
  Attribute,
  MimeType,
} from '@arkiv-network/sdk';

// The Arkiv SDK extends viem clients with entity actions (createEntity,
// getEntity, buildQuery, etc.). Use the *Arkiv* variants so those methods
// are visible to the type-checker.
type WalletClient = WalletArkivClient;
type PublicClient = PublicArkivClient;
type Hex = `0x${string}`;
const asHex = (key: string): Hex => key as Hex;

/**
 * Create Arkiv wallet client from private key
 */
export function createArkivWalletClient(privateKey: string): WalletClient {
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  return createWalletClient({
    chain: braga,
    transport: http(process.env.ARKIV_RPC_URL || 'https://braga.hoodi.arkiv.network/rpc'),
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
  return createPublicClient({
    chain: braga,
    transport: http(process.env.ARKIV_RPC_URL || 'https://braga.hoodi.arkiv.network/rpc'),
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
  const attributes: Attribute[] = [
    { key: 'type', value: 'device-beacon' },
    { key: 'devicePub', value: entity.devicePub },
    { key: 'nodeId', value: entity.nodeId },
  ];
  
  if (entity.location && entity.location.lat != null && entity.location.lon != null) {
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

/**
 * CREATE - Create a generic entity on Arkiv network
 */
export async function createEntity(
  walletClient: WalletClient,
  payload: string | object,
  contentType: MimeType = 'application/json',
  attributes: Attribute[] = [],
  expiresIn: number = 31536000 // 1 year default
): Promise<{ entityKey: string; txHash: string }> {
  const payloadData = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const payloadObj = stringToPayload(payloadData);

  const { entityKey, txHash } = await walletClient.createEntity({
    payload: payloadObj,
    contentType,
    attributes,
    expiresIn,
  });

  return { entityKey, txHash };
}

/**
 * CREATE - Batch create multiple entities
 *
 * Returns the SDK's `MutateEntitiesReturnType` shape (single tx hash + list
 * of created entity keys), not an array of {entityKey,txHash} pairs — Arkiv
 * mutates all entities in a single transaction.
 */
export async function createEntities(
  walletClient: WalletClient,
  entities: Array<{
    payload: string | object;
    contentType?: MimeType;
    attributes?: Attribute[];
    expiresIn?: number;
  }>
): Promise<{ txHash: string; entityKeys: string[] }> {
  const creates = entities.map(entity => {
    const payloadData = typeof entity.payload === 'string'
      ? entity.payload
      : JSON.stringify(entity.payload);

    return {
      payload: stringToPayload(payloadData),
      contentType: entity.contentType ?? ('application/json' as MimeType),
      attributes: entity.attributes ?? [],
      expiresIn: entity.expiresIn ?? 31536000,
    };
  });

  const result = await walletClient.mutateEntities({ creates });
  return {
    txHash: result.txHash,
    entityKeys: result.createdEntities,
  };
}

/**
 * READ - Get entity by entity key
 */
export async function getEntity(
  publicClient: PublicClient,
  entityKey: string
): Promise<Entity> {
  return await publicClient.getEntity(asHex(entityKey));
}

/**
 * READ - Get entity and decode payload to string
 */
export async function getEntityAsString(
  publicClient: PublicClient,
  entityKey: string
): Promise<{ entity: Entity; data: string }> {
  const entity = await publicClient.getEntity(asHex(entityKey));
  const data = entity.toText();
  return { entity, data };
}

/**
 * READ - Get entity and decode payload to JSON object
 */
export async function getEntityAsJson<T = any>(
  publicClient: PublicClient,
  entityKey: string
): Promise<{ entity: Entity; data: T }> {
  const entity = await publicClient.getEntity(asHex(entityKey));
  const data = entity.toJson() as T;
  return { entity, data };
}

/**
 * READ - Query entities with filters
 */
export async function queryEntities(
  publicClient: PublicClient,
  filters: Array<{ key: string; value: string }>
): Promise<Entity[]> {
  const predicates = filters.map(filter => eq(filter.key, filter.value));
  const result = await publicClient
    .buildQuery()
    .where(predicates)
    .fetch();

  return result.entities;
}

/**
 * READ - Query entities by type
 */
export async function queryEntitiesByType(
  publicClient: PublicClient,
  type: string
): Promise<Entity[]> {
  return queryEntities(publicClient, [{ key: 'type', value: type }]);
}

/**
 * READ - Query device beacon entities
 */
export async function queryDeviceBeacons(
  publicClient: PublicClient,
  filters?: {
    nodeId?: string;
    devicePub?: string;
    ipfsHash?: string;
  }
): Promise<Entity[]> {
  const filterArray: Array<{ key: string; value: string }> = [
    { key: 'type', value: 'device-beacon' }
  ];
  
  if (filters?.nodeId) {
    filterArray.push({ key: 'nodeId', value: filters.nodeId });
  }
  
  if (filters?.devicePub) {
    filterArray.push({ key: 'devicePub', value: filters.devicePub });
  }
  
  if (filters?.ipfsHash) {
    filterArray.push({ key: 'ipfsHash', value: filters.ipfsHash });
  }
  
  return queryEntities(publicClient, filterArray);
}

/**
 * UPDATE - Extend entity expiration time
 */
export async function extendEntity(
  walletClient: WalletClient,
  entityKey: string,
  expiresIn: number
): Promise<{ txHash: string; entityKey: string }> {
  return walletClient.extendEntity({
    entityKey: asHex(entityKey),
    expiresIn,
  });
}

/**
 * UPDATE - Update entity payload and attributes (by creating new entity with same attributes)
 * Note: Arkiv doesn't support direct updates, so this creates a new entity
 * with updated data. You may want to mark the old one as deprecated.
 */
export async function updateEntity(
  walletClient: WalletClient,
  entityKey: string,
  newPayload: string | object,
  contentType: MimeType = 'application/json',
  additionalAttributes: Attribute[] = [],
  expiresIn: number = 31536000
): Promise<{ entityKey: string; txHash: string }> {
  // Get existing entity to preserve some attributes
  const publicClient = createArkivPublicClient();
  const existingEntity = await publicClient.getEntity(asHex(entityKey));

  // Merge existing attributes with new ones — new ones override.
  // Attribute.value is `string | number`; preserve numeric values as-is.
  const attrMap = new Map<string, string | number>();
  existingEntity.attributes.forEach((attr) => attrMap.set(attr.key, attr.value));
  additionalAttributes.forEach((attr) => attrMap.set(attr.key, attr.value));

  // Reference back to the old entity
  attrMap.set('previousEntityKey', entityKey);
  attrMap.set('updatedAt', new Date().toISOString());

  const attributes: Attribute[] = Array.from(attrMap.entries()).map(([key, value]) => ({
    key,
    value,
  }));

  return createEntity(walletClient, newPayload, contentType, attributes, expiresIn);
}

/**
 * DELETE - Check if entity is expired (Arkiv entities expire naturally)
 */
export async function isEntityExpired(
  publicClient: PublicClient,
  entityKey: string
): Promise<boolean> {
  try {
    await publicClient.getEntity(asHex(entityKey));
    return false;
  } catch {
    return true;
  }
}

/**
 * DELETE - Get entity expiration info
 */
export async function getEntityExpiration(
  publicClient: PublicClient,
  entityKey: string
): Promise<{ expirationBlock: bigint | undefined; isExpired: boolean } | null> {
  try {
    const entity = await publicClient.getEntity(asHex(entityKey));
    return {
      expirationBlock: entity.expiresAtBlock,
      isExpired: entity.expiresAtBlock === undefined,
    };
  } catch (error) {
    return null; // Entity doesn't exist
  }
}
