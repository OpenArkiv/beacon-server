import { ethers } from 'ethers';
import crypto, { createPublicKey, verify, KeyObject } from 'crypto';
import { logger } from '../index.js';

/**
 * SubjectPublicKeyInfo DER prefix for an Ed25519 public key.
 * Format: AlgorithmIdentifier (id-Ed25519 = 1.3.101.112) + BIT STRING (32-byte key).
 * Concatenating this prefix with a 32-byte raw key yields a valid SPKI DER encoding
 * that Node's crypto module accepts via createPublicKey({ format: 'der', type: 'spki' }).
 */
const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x70, 0x03, 0x21, 0x00,
]);

function ed25519KeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${raw.length}`);
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

function fromHex(value: string, label: string): Buffer {
  const stripped = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]*$/.test(stripped) || stripped.length % 2 !== 0) {
    throw new Error(`Invalid hex for ${label}`);
  }
  return Buffer.from(stripped, 'hex');
}

/**
 * Verify an Ed25519 signature over a message and return the canonical
 * device identifier (the lowercased hex of the 32-byte public key, no 0x).
 */
export function verifyEd25519Signature(
  message: string,
  signature: string,
  publicKey: string
): string {
  const pubkeyBuf = fromHex(publicKey, 'publicKey');
  if (pubkeyBuf.length !== 32) {
    throw new Error(`Invalid Ed25519 public key length: expected 32 bytes, got ${pubkeyBuf.length}`);
  }
  const sigBuf = fromHex(signature, 'signature');
  if (sigBuf.length !== 64) {
    throw new Error(`Invalid Ed25519 signature length: expected 64 bytes, got ${sigBuf.length}`);
  }

  const messageBuf = Buffer.from(message, 'utf8');
  const keyObject = ed25519KeyFromRaw(pubkeyBuf);
  const ok = verify(null, messageBuf, keyObject, sigBuf);
  if (!ok) {
    throw new Error('Ed25519 signature verification failed');
  }

  return pubkeyBuf.toString('hex').toLowerCase();
}

/**
 * Derive a deterministic Arkiv-paying wallet private key from any device
 * identifier (EVM address or Ed25519 pubkey hex) plus the server salt.
 * Same scheme as generateServerWalletFromAddress; identifier is normalized
 * to lowercase before PBKDF2.
 */
export function generateServerWalletFromIdentifier(
  identifier: string,
  serverSalt: string
): string {
  const normalized = identifier.toLowerCase();
  const derivedKey = crypto.pbkdf2Sync(normalized, serverSalt, 100000, 32, 'sha256');
  const privateKey = '0x' + derivedKey.toString('hex');

  // Sanity-check: the derived key must be a valid secp256k1 private key.
  // ethers throws on out-of-range or zero keys; we surface a clear error.
  try {
    new ethers.Wallet(privateKey);
  } catch (error) {
    throw new Error(
      `Failed to derive valid wallet from identifier: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
  return privateKey;
}

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
 * Generate a deterministic private key from device address and server salt.
 * Thin wrapper around generateServerWalletFromIdentifier kept for backward
 * compatibility with callers that pass an EVM address.
 */
export function generateServerWalletFromAddress(
  deviceAddress: string,
  serverSalt: string
): string {
  return generateServerWalletFromIdentifier(deviceAddress, serverSalt);
}

