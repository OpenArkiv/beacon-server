import { ethers } from 'ethers';
import crypto from 'crypto';
import { logger } from '../index.js';

/**
 * Verify signature and extract wallet address
 */
export function verifySignatureAndGetAddress(
  message: string,
  signature: string
): string {
  // Log detailed information about the signature verification attempt
  logger.debug('Starting signature verification', {
    messageLength: message.length,
    signatureLength: signature.length,
    messagePreview: message.substring(0, 200),
    messageEnd: message.length > 200 ? '...' + message.substring(message.length - 100) : message,
    signaturePreview: signature.substring(0, 20),
    signatureFormat: signature.startsWith('0x') ? 'hex-with-prefix' : 'hex-without-prefix',
    expectedSignatureLength: 132, // 0x + 130 hex chars = 132
  });

  // Validate signature format
  if (!signature) {
    logger.error('Signature is empty or undefined');
    throw new Error('Invalid signature: Signature is empty');
  }

  // Normalize signature format (ensure it starts with 0x)
  let normalizedSignature = signature;
  if (!signature.startsWith('0x')) {
    logger.debug('Adding 0x prefix to signature', {
      originalLength: signature.length,
    });
    normalizedSignature = '0x' + signature;
  }

  // Validate signature length (should be 65 bytes = 130 hex chars + 0x prefix = 132 chars)
  const signatureWithoutPrefix = normalizedSignature.slice(2);
  if (signatureWithoutPrefix.length !== 130) {
    logger.error('Invalid signature length', {
      actualLength: signatureWithoutPrefix.length,
      expectedLength: 130,
      signatureWithPrefix: normalizedSignature.length,
      signaturePreview: normalizedSignature.substring(0, 20),
    });
    throw new Error(`Invalid signature: Expected 130 hex characters, got ${signatureWithoutPrefix.length}`);
  }

  try {
    logger.debug('Calling ethers.verifyMessage', {
      messageLength: message.length,
      signatureLength: normalizedSignature.length,
    });

    const recoveredAddress = ethers.verifyMessage(message, normalizedSignature);
    
    logger.info('Signature verified successfully', {
      recoveredAddress,
      messageLength: message.length,
    });

    return recoveredAddress;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error('Signature verification failed', {
      error: errorMessage,
      stack: errorStack,
      messageLength: message.length,
      messagePreview: message.substring(0, 200),
      signatureLength: normalizedSignature.length,
      signaturePreview: normalizedSignature.substring(0, 20),
      // Check if message might be JSON
      isMessageJSON: (() => {
        try {
          JSON.parse(message);
          return true;
        } catch {
          return false;
        }
      })(),
      // Check for common issues
      messageHasWhitespace: /\s/.test(message),
      messageHasNewlines: message.includes('\n'),
      messageHasTabs: message.includes('\t'),
    });

    throw new Error(`Invalid signature: ${errorMessage}`);
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
  logger.debug('Generating server wallet from device address', {
    deviceAddress,
    serverSaltLength: serverSalt.length,
    serverSaltSet: !!serverSalt,
  });

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
  
  logger.debug('Derived private key', {
    privateKeyLength: privateKey.length,
    privateKeyPreview: privateKey.substring(0, 10) + '...',
  });
  
  // Validate the private key
  try {
    const wallet = new ethers.Wallet(privateKey);
    logger.debug('Wallet validation successful', {
      walletAddress: wallet.address,
      deviceAddress,
      addressesMatch: wallet.address.toLowerCase() === normalizedAddress,
    });
  } catch (error) {
    logger.error('Failed to validate generated private key', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      deviceAddress,
      privateKeyLength: privateKey.length,
    });
    throw new Error(`Failed to generate valid wallet from address: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  return privateKey;
}

