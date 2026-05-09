import express, { Request, Response } from 'express';
import {
  verifySignatureAndGetAddress,
  verifyEd25519Signature,
  generateServerWalletFromIdentifier,
} from '../utils/signature.js';
import { createArkivWalletClient, uploadEntityToArkiv, getWalletAddressFromPrivateKey } from '../utils/arkiv.js';
import { uploadToPinata, cleanupTempFile } from '../utils/ipfs.js';
import { chatStorage } from '../utils/storage.js';
import { upload } from '../middleware/upload.js';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceEntity, FileUploadRequest, UploadResponse } from '../types/index.js';
import { logger } from '../index.js';
import { ethers } from 'ethers';

const router = express.Router();

// Signature bypass is a dev/demo escape hatch. It must be explicitly enabled
// via ALLOW_BYPASS_SIGNATURE=true in the environment, otherwise any incoming
// `bypassSignature=true` is rejected. Production deployments should leave it
// off so a real device signature is required for every Arkiv upload.
const BYPASS_SIGNATURE_ALLOWED = process.env.ALLOW_BYPASS_SIGNATURE === 'true';

// When bypass is allowed, the server uses this mock device key to derive its
// Arkiv-paying wallet. Override via MOCK_DEVICE_PRIVATE_KEY env var; the
// hardcoded fallback is only used in local dev.
const MOCK_DEVICE_PRIVATE_KEY =
  process.env.MOCK_DEVICE_PRIVATE_KEY ??
  '0xa8d3aacecac70fe98fbc8ca7f76fb703c30c44eae2fd0d57c06123a7e69e0621';

/**
 * POST /api/device/upload
 * Upload device entity data to Arkiv network
 * Supports optional file upload to IPFS
 */
router.post('/upload', upload.single('file') as any, async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    
    // Parse JSON fields from multipart form data
    let entity: DeviceEntity;
    // Signature payload accepts an optional `pubkey` and `scheme` field.
    // - scheme="ed25519" + pubkey (32-byte hex) → Ed25519 verification (preferred)
    // - otherwise → legacy EVM personal_sign verification via ethers
    let signature: {
      message: string;
      signature: string;
      pubkey?: string;
      scheme?: string;
    } | undefined;
    let bypassSignature: boolean = false;

    try {
      entity = typeof req.body.entity === 'string'
        ? JSON.parse(req.body.entity)
        : req.body.entity;

      // Parse bypassSignature flag (for dev/demo purposes)
      if (req.body.bypassSignature !== undefined) {
        const requested = typeof req.body.bypassSignature === 'string'
          ? req.body.bypassSignature === 'true'
          : Boolean(req.body.bypassSignature);
        if (requested && !BYPASS_SIGNATURE_ALLOWED) {
          logger.warn('bypassSignature requested but disabled by environment', {
            path: req.path,
            method: req.method,
          });
          return res.status(403).json({
            error: 'bypassSignature is not allowed in this environment. Set ALLOW_BYPASS_SIGNATURE=true to enable for dev/demo.',
          });
        }
        bypassSignature = requested;
      }

      if (req.body.signature !== undefined) {
        signature = typeof req.body.signature === 'string'
          ? JSON.parse(req.body.signature)
          : req.body.signature;
      }
    } catch (parseError) {
      logger.error('Failed to parse JSON fields', {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        stack: parseError instanceof Error ? parseError.stack : undefined,
        body: req.body,
        path: req.path,
        method: req.method,
      });
      return res.status(400).json({ 
        error: 'Invalid JSON in entity or signature fields' 
      });
    }
    
    // Validate required fields
    if (!entity) {
      logger.warn('Missing entity field', {
        path: req.path,
        method: req.method,
        body: req.body,
      });
      return res.status(400).json({ 
        error: 'Missing required field: entity is required' 
      });
    }
    
    // Signature required for Arkiv uploads, unless bypassSignature is enabled (dev/demo)
    if (!bypassSignature) {
      if (!signature) {
        logger.warn('Missing signature for Arkiv upload', {
          path: req.path,
          method: req.method,
        });
        return res.status(400).json({
          error: 'Missing required field: signature is required for Arkiv uploads (or set bypassSignature=true for dev/demo)'
        });
      }

      if (!signature.message || !signature.signature) {
        logger.warn('Invalid signature format', {
          path: req.path,
          method: req.method,
          hasMessage: !!signature.message,
          hasSignature: !!signature.signature,
        });
        return res.status(400).json({
          error: 'Signature must include message and signature fields'
        });
      }
    }

    let deviceAddress: string | undefined;
    let serverPrivateKey: string | undefined;

    if (bypassSignature) {
      try {
        const mockWallet = new ethers.Wallet(MOCK_DEVICE_PRIVATE_KEY);
        deviceAddress = mockWallet.address;
        logger.info('Using mock device address for bypass (bypassSignature enabled)', {
          deviceAddress,
          path: req.path,
          hasSignature: !!signature,
        });
      } catch (mockError) {
        logger.error('Failed to create mock wallet', {
          error: mockError instanceof Error ? mockError.message : String(mockError),
          path: req.path,
          method: req.method,
        });
        return res.status(500).json({
          error: `Failed to create mock wallet: ${mockError instanceof Error ? mockError.message : 'Unknown error'}`
        });
      }
    } else if (signature) {
      const isEd25519 = signature.scheme === 'ed25519' || !!signature.pubkey;
      try {
        if (isEd25519) {
          if (!signature.pubkey) {
            throw new Error('Ed25519 signatures require a pubkey field');
          }
          deviceAddress = verifyEd25519Signature(
            signature.message,
            signature.signature,
            signature.pubkey
          );
          logger.info('Ed25519 signature verified', {
            deviceIdentifier: deviceAddress,
            path: req.path,
          });
        } else {
          deviceAddress = verifySignatureAndGetAddress(signature.message, signature.signature);
          logger.info('EVM signature verified', {
            deviceAddress,
            path: req.path,
          });
        }
      } catch (error) {
        logger.error('Signature verification failed', {
          scheme: isEd25519 ? 'ed25519' : 'evm',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          signatureMessage: signature.message?.substring(0, 100),
          signatureLength: signature.signature?.length,
          path: req.path,
          method: req.method,
        });
        return res.status(401).json({
          error: `Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }

    if (!deviceAddress) {
      logger.error('Device address not available for server wallet generation', {
        bypassSignature,
        hasSignature: !!signature,
        path: req.path,
        method: req.method,
      });
      return res.status(400).json({
        error: 'Device address is required. Provide a valid signature or enable bypassSignature for dev/demo.'
      });
    }

    const serverSalt = process.env.SERVER_SALT;
    if (!serverSalt) {
      logger.error('SERVER_SALT environment variable not set', {
        path: req.path,
        method: req.method,
      });
      return res.status(500).json({
        error: 'Server configuration error: SERVER_SALT not set'
      });
    }

    try {
      serverPrivateKey = generateServerWalletFromIdentifier(deviceAddress, serverSalt);
      logger.debug('Server wallet generated successfully', {
        deviceIdentifier: deviceAddress,
        path: req.path,
      });
    } catch (error) {
      logger.error('Failed to generate server wallet', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        deviceAddress,
        path: req.path,
        method: req.method,
      });
      return res.status(500).json({
        error: `Failed to generate server wallet: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
    
    const deviceEntity: DeviceEntity = {
      _id: entity._id || `node_${uuidv4()}`,
      nodeId: entity.nodeId || entity._id || `node_${uuidv4()}`,
      devicePub: entity.devicePub || deviceAddress,
      location: entity.location,
      lastSeen: entity.lastSeen || new Date().toISOString(),
      storage: entity.storage,
      tags: entity.tags || [],
      text: entity.text || '',
    };

    chatStorage.storeChat(deviceEntity);

    // Upload file to IPFS if provided
    let ipfsHash: string | undefined;
    if (file) {
      try {
        logger.info('Uploading file to IPFS', {
          filename: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          nodeId: deviceEntity.nodeId,
          path: req.path,
        });
        ipfsHash = await uploadToPinata(file, {
          name: file.originalname,
          devicePub: deviceEntity.devicePub,
          nodeId: deviceEntity.nodeId,
        });
        
        logger.info('File uploaded to IPFS successfully', {
          filename: file.originalname,
          ipfsHash,
          path: req.path,
        });
        
        // Cleanup temp file
        cleanupTempFile(file.path);
      } catch (error) {
        logger.error('IPFS upload failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          filename: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          filePath: file.path,
          nodeId: deviceEntity.nodeId,
          path: req.path,
          method: req.method,
        });
        // Cleanup temp file even on error
        if (file.path) {
          cleanupTempFile(file.path);
        }
        return res.status(500).json({ 
          error: `IPFS upload failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
    }
    
    if (!serverPrivateKey) {
      logger.error('Server private key missing for Arkiv upload', {
        hasSignature: !!signature,
        path: req.path,
        method: req.method,
      });
      return res.status(400).json({
        error: 'Server private key is required for Arkiv uploads. Provide a valid signature or enable bypassSignature.'
      });
    }

    // Get wallet address for error reporting
    const walletAddress = getWalletAddressFromPrivateKey(serverPrivateKey);
    
    // Create Arkiv wallet client and upload entity
    let uploadResult: UploadResponse;
    try {
      logger.info('Uploading entity to Arkiv', {
        nodeId: deviceEntity.nodeId,
        devicePub: deviceEntity.devicePub,
        walletAddress,
        hasIpfsHash: !!ipfsHash,
        path: req.path,
      });
      const walletClient = createArkivWalletClient(serverPrivateKey);
      const result = await uploadEntityToArkiv(walletClient, deviceEntity, ipfsHash);
      
      logger.info('Successfully uploaded entity to Arkiv', {
        nodeId: deviceEntity.nodeId,
        entityKey: result.entityKey,
        txHash: result.txHash,
        walletAddress,
        path: req.path,
      });
      
      uploadResult = {
        entityKey: result.entityKey,
        txHash: result.txHash,
        ...(ipfsHash && { ipfsHash }), // Only include ipfsHash if it exists
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Arkiv upload failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        nodeId: deviceEntity.nodeId,
        devicePub: deviceEntity.devicePub,
        walletAddress,
        ipfsHash,
        path: req.path,
        method: req.method,
      });
      
      // Check if it's an insufficient funds error
      if (errorMessage.includes('insufficient funds') || 
          errorMessage.includes('exceeds the balance') ||
          errorMessage.includes('balance of the account')) {
        logger.warn('Insufficient funds for Arkiv transaction', {
          walletAddress,
          nodeId: deviceEntity.nodeId,
          path: req.path,
        });
        return res.status(402).json({ 
          error: 'Insufficient funds: The server wallet does not have enough funds to execute this transaction.',
          walletAddress: walletAddress,
          message: `Please fund the wallet address: ${walletAddress}`,
          faucetUrl: process.env.ARKIV_RPC_URL?.includes('mendoza') 
            ? 'https://mendoza.hoodi.arkiv.network/faucet/' 
            : undefined,
        });
      }
      
      return res.status(500).json({ 
        error: `Arkiv upload failed: ${errorMessage}`,
        walletAddress: walletAddress, // Include wallet address for debugging
      });
    }
    
    res.status(200).json({
      success: true,
      data: uploadResult,
    });
  } catch (error) {
    logger.error('Unexpected error in upload handler', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: req.path,
      method: req.method,
      body: req.body,
      hasFile: !!(req as any).file,
    });
    res.status(500).json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
});

/**
 * POST /api/device/verify
 * Verify device signature without uploading
 * Supports bypassSignature flag for dev/demo purposes
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { signature, bypassSignature: bypassFlag } = req.body;
    const requestedBypass = typeof bypassFlag === 'string'
      ? bypassFlag === 'true'
      : Boolean(bypassFlag);
    if (requestedBypass && !BYPASS_SIGNATURE_ALLOWED) {
      logger.warn('bypassSignature requested but disabled by environment', {
        path: req.path,
        method: req.method,
      });
      return res.status(403).json({
        error: 'bypassSignature is not allowed in this environment. Set ALLOW_BYPASS_SIGNATURE=true to enable for dev/demo.',
      });
    }
    const bypassSignature = requestedBypass;
    
    if (!signature || !signature.message || !signature.signature) {
      logger.warn('Missing signature fields in verify request', {
        hasSignature: !!signature,
        hasMessage: !!signature?.message,
        hasSignatureField: !!signature?.signature,
        path: req.path,
        method: req.method,
      });
      return res.status(400).json({ 
        error: 'Missing required fields: signature.message and signature.signature' 
      });
    }
    
    try {
      const deviceAddress = verifySignatureAndGetAddress(signature.message, signature.signature);
      logger.info('Signature verified successfully', {
        deviceAddress,
        path: req.path,
      });
      
      res.status(200).json({
        success: true,
        deviceAddress,
      });
    } catch (error) {
      // If bypassSignature is enabled, use mock device private key for dev/demo
      if (bypassSignature) {
        logger.warn('Signature verification failed, using mock device key (bypassSignature enabled)', {
          error: error instanceof Error ? error.message : String(error),
          signatureMessage: signature.message?.substring(0, 100),
          signatureLength: signature.signature?.length,
          path: req.path,
          method: req.method,
        });
        try {
          const mockWallet = new ethers.Wallet(MOCK_DEVICE_PRIVATE_KEY);
          const deviceAddress = mockWallet.address;
          logger.info('Using mock device address for bypass', {
            deviceAddress,
            path: req.path,
          });
          
          res.status(200).json({
            success: true,
            deviceAddress,
            bypassed: true,
            message: 'Signature verification bypassed using mock device key',
          });
        } catch (mockError) {
          logger.error('Failed to create mock wallet', {
            error: mockError instanceof Error ? mockError.message : String(mockError),
            path: req.path,
            method: req.method,
          });
          return res.status(500).json({ 
            error: `Failed to create mock wallet: ${mockError instanceof Error ? mockError.message : 'Unknown error'}` 
          });
        }
      } else {
        logger.error('Signature verification failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          signatureMessage: signature.message?.substring(0, 100),
          signatureLength: signature.signature?.length,
          path: req.path,
          method: req.method,
        });
        return res.status(401).json({ 
          error: `Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
    }
  } catch (error) {
    logger.error('Unexpected error in verify handler', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: req.path,
      method: req.method,
      body: req.body,
    });
    res.status(500).json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
});

/**
 * GET /api/device/chats
 * Get all stored chats
 */
router.get('/chats', async (req: Request, res: Response) => {
  try {
    const chats = chatStorage.getAllChats();
    
    logger.debug('Retrieved chats', {
      count: chats.length,
      path: req.path,
      query: req.query,
    });
    
    res.status(200).json({
      success: true,
      count: chats.length,
      data: chats,
    });
  } catch (error) {
    logger.error('Failed to get chats', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: req.path,
      method: req.method,
      query: req.query,
    });
    res.status(500).json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
});

export default router;

