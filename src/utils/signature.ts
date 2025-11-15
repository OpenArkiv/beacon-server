import { ethers } from 'ethers';
import crypto from 'crypto';

/**
 * Verify signature and extract wallet address
 */
export function verifySignatureAndGetAddress(
  message: string,
  signature: string
): string {
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    return recoveredAddress;
  } catch (error) {
    throw new Error(`Invalid signature: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a deterministic private key from device address and server salt
 * Uses PBKDF2 to derive a key from the address + salt
 */
export function generateServerWalletFromAddress(
  deviceAddress: string,
  serverSalt: string
): string {
  // Normalize address to lowercase for consistency
  const normalizedAddress = deviceAddress.toLowerCase();
  
  // Use PBKDF2 to derive a deterministic private key
  const derivedKey = crypto.pbkdf2Sync(
    normalizedAddress,
    serverSalt,
    100000, // iterations
    32, // key length (32 bytes = 256 bits for private key)
    'sha256'
  );
  
  // Convert to hex and ensure it's a valid private key format
  const privateKey = '0x' + derivedKey.toString('hex');
  
  // Validate the private key
  try {
    new ethers.Wallet(privateKey);
  } catch (error) {
    throw new Error(`Failed to generate valid wallet from address: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  return privateKey;
}

