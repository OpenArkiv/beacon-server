import express, { Request, Response } from 'express';
import { verifySignatureAndGetAddress, generateServerWalletFromAddress } from '../utils/signature.js';
import { createArkivWalletClient, uploadEntityToArkiv, getWalletAddressFromPrivateKey } from '../utils/arkiv.js';
import { uploadToPinata, cleanupTempFile } from '../utils/ipfs.js';
import { sendToXXNetwork } from '../utils/xxnetwork.js';
import { chatStorage } from '../utils/storage.js';
import { upload } from '../middleware/upload.js';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceEntity, FileUploadRequest, UploadResponse } from '../types/index.js';
import { logger } from '../index.js';
import { ethers } from 'ethers';

const router = express.Router();

// Mock device private key for dev/demo purposes when bypassing signature
const MOCK_DEVICE_PRIVATE_KEY = '0xa8d3aacecac70fe98fbc8ca7f76fb703c30c44eae2fd0d57c06123a7e69e0621';

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
    let signature: { message: string; signature: string } | undefined;
    let whistleblow: boolean = false;
    let bypassSignature: boolean = false;
    
    try {
      entity = typeof req.body.entity === 'string' 
        ? JSON.parse(req.body.entity) 
        : req.body.entity;
      
      // Parse whistleblow field first (before signature validation)
      if (req.body.whistleblow !== undefined) {
        whistleblow = typeof req.body.whistleblow === 'string'
          ? req.body.whistleblow === 'true'
          : Boolean(req.body.whistleblow);
      }
      
      // Parse bypassSignature flag (for dev/demo purposes)
      if (req.body.bypassSignature !== undefined) {
        bypassSignature = typeof req.body.bypassSignature === 'string'
          ? req.body.bypassSignature === 'true'
          : Boolean(req.body.bypassSignature);
      }
      
      // Parse signature (optional when whistleblow is true)
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
    
    // Signature is only required for Arkiv uploads (when whistleblow is false)
    // Unless bypassSignature is enabled for dev/demo purposes
    if (!whistleblow && !bypassSignature) {
      if (!signature) {
        logger.warn('Missing signature for Arkiv upload', {
          path: req.path,
          method: req.method,
          whistleblow,
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
    
    // Verify signature and get device address (only for Arkiv uploads)
    let deviceAddress: string | undefined;
    let serverPrivateKey: string | undefined;
    
    if (!whistleblow) {
      // If bypassSignature is enabled, use mock device private key directly
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
        // Normal signature verification flow
        try {
          deviceAddress = verifySignatureAndGetAddress(signature.message, signature.signature);
          logger.info('Signature verified successfully', {
            deviceAddress,
            path: req.path,
          });
        } catch (error) {
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
      
      // Ensure deviceAddress is set before generating server wallet
      if (!deviceAddress) {
        logger.error('Device address not available for server wallet generation', {
          bypassSignature,
          hasSignature: !!signature,
          whistleblow,
          path: req.path,
          method: req.method,
        });
        return res.status(400).json({ 
          error: 'Device address is required. Provide a valid signature or enable bypassSignature for dev/demo.' 
        });
      }
      
      // Generate server-side wallet from device address
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
        serverPrivateKey = generateServerWalletFromAddress(deviceAddress, serverSalt);
        logger.debug('Server wallet generated successfully', {
          deviceAddress,
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
    }
    
    // Validate and prepare entity
    // For whistleblow, use entity.devicePub if provided, otherwise use anonymous placeholder
    const deviceEntity: DeviceEntity = {
      _id: entity._id || `node_${uuidv4()}`,
      nodeId: entity.nodeId || entity._id || `node_${uuidv4()}`,
      devicePub: entity.devicePub || deviceAddress || `anonymous_${uuidv4()}`,
      location: entity.location,
      lastSeen: entity.lastSeen || new Date().toISOString(),
      storage: entity.storage,
      tags: entity.tags || [],
      text: entity.text || '',
    };
    
    // Store chat in memory
    chatStorage.storeChat(deviceEntity, whistleblow);
    
    // If whistleblow is true, send to xx-network instead of Arkiv
    if (whistleblow) {
      try {
        logger.info('Sending whistleblow message to xx-network', {
          nodeId: deviceEntity.nodeId,
          devicePub: deviceEntity.devicePub,
          path: req.path,
        });
        const xxNetworkData = await sendToXXNetwork(deviceEntity);
        
        logger.info('Successfully sent message to xx-network', {
          nodeId: deviceEntity.nodeId,
          dmPubKey: xxNetworkData.dmPubKey,
          messageIds: xxNetworkData.messageIds,
          path: req.path,
        });
        
        res.status(200).json({
          success: true,
          message: 'Message sent to xx-network',
          data: {
            nodeId: deviceEntity.nodeId,
            whistleblow: true,
            xxNetwork: {
              dmPubKey: xxNetworkData.dmPubKey,
              dmToken: xxNetworkData.dmToken,
              dmRecvPubKey: xxNetworkData.dmRecvPubKey,
              dmRecvToken: xxNetworkData.dmRecvToken,
              userReceptionID: xxNetworkData.userReceptionID,
              networkStatus: xxNetworkData.networkStatus,
              messageIds: xxNetworkData.messageIds,
              roundIds: xxNetworkData.roundIds,
              receivedMessages: xxNetworkData.receivedMessages,
            },
          },
        });
        return;
      } catch (error) {
        logger.error('Failed to send to xx-network', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          nodeId: deviceEntity.nodeId,
          devicePub: deviceEntity.devicePub,
          path: req.path,
          method: req.method,
        });
        return res.status(500).json({ 
          error: `Failed to send to xx-network: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
    }
    
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
    
    // For Arkiv uploads, we need serverPrivateKey (which requires signature)
    if (!serverPrivateKey) {
      logger.error('Server private key missing for Arkiv upload', {
        whistleblow,
        hasSignature: !!signature,
        path: req.path,
        method: req.method,
      });
      return res.status(400).json({ 
        error: 'Server private key is required for Arkiv uploads. Signature must be provided when whistleblow is false.' 
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
    const bypassSignature = typeof bypassFlag === 'string' 
      ? bypassFlag === 'true' 
      : Boolean(bypassFlag);
    
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

/**
 * GET /api/device/whistleblow
 * Get all whistleblow messages
 */
router.get('/whistleblow', async (req: Request, res: Response) => {
  try {
    const messages = chatStorage.getWhistleblowMessages();
    
    logger.debug('Retrieved whistleblow messages', {
      count: messages.length,
      path: req.path,
      query: req.query,
    });
    
    res.status(200).json({
      success: true,
      count: messages.length,
      data: messages,
    });
  } catch (error) {
    logger.error('Failed to get whistleblow messages', {
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

