import express, { Request, Response } from 'express';
import { verifySignatureAndGetAddress, generateServerWalletFromAddress } from '../utils/signature.js';
import { createArkivWalletClient, uploadEntityToArkiv, getWalletAddressFromPrivateKey } from '../utils/arkiv.js';
import { uploadToPinata, cleanupTempFile } from '../utils/ipfs.js';
import { sendToXXNetwork } from '../utils/xxnetwork.js';
import { chatStorage } from '../utils/storage.js';
import { upload } from '../middleware/upload.js';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceEntity, FileUploadRequest, UploadResponse } from '../types/index.js';

const router = express.Router();

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
      
      // Parse signature (optional when whistleblow is true)
      if (req.body.signature !== undefined) {
        signature = typeof req.body.signature === 'string'
          ? JSON.parse(req.body.signature)
          : req.body.signature;
      }
    } catch (parseError) {
      return res.status(400).json({ 
        error: 'Invalid JSON in entity or signature fields' 
      });
    }
    
    // Validate required fields
    if (!entity) {
      return res.status(400).json({ 
        error: 'Missing required field: entity is required' 
      });
    }
    
    // Signature is only required for Arkiv uploads (when whistleblow is false)
    if (!whistleblow) {
      if (!signature) {
        return res.status(400).json({ 
          error: 'Missing required field: signature is required for Arkiv uploads' 
        });
      }
      
      if (!signature.message || !signature.signature) {
        return res.status(400).json({ 
          error: 'Signature must include message and signature fields' 
        });
      }
    }
    
    // Verify signature and get device address (only for Arkiv uploads)
    let deviceAddress: string | undefined;
    let serverPrivateKey: string | undefined;
    
    if (!whistleblow && signature) {
      try {
        deviceAddress = verifySignatureAndGetAddress(signature.message, signature.signature);
      } catch (error) {
        return res.status(401).json({ 
          error: `Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
      
      // Generate server-side wallet from device address
      const serverSalt = process.env.SERVER_SALT;
      if (!serverSalt) {
        return res.status(500).json({ 
          error: 'Server configuration error: SERVER_SALT not set' 
        });
      }
      
      try {
        serverPrivateKey = generateServerWalletFromAddress(deviceAddress, serverSalt);
      } catch (error) {
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
    };
    
    // Store chat in memory
    chatStorage.storeChat(deviceEntity, whistleblow);
    
    // If whistleblow is true, send to xx-network instead of Arkiv
    if (whistleblow) {
      try {
        const xxNetworkData = await sendToXXNetwork(deviceEntity);
        
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
        console.error('xx-network send error:', error);
        return res.status(500).json({ 
          error: `Failed to send to xx-network: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
    }
    
    // Upload file to IPFS if provided
    let ipfsHash: string | undefined;
    if (file) {
      try {
        ipfsHash = await uploadToPinata(file, {
          name: file.originalname,
          devicePub: deviceEntity.devicePub,
          nodeId: deviceEntity.nodeId,
        });
        
        // Cleanup temp file
        cleanupTempFile(file.path);
      } catch (error) {
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
      return res.status(400).json({ 
        error: 'Server private key is required for Arkiv uploads. Signature must be provided when whistleblow is false.' 
      });
    }
    
    // Get wallet address for error reporting
    const walletAddress = getWalletAddressFromPrivateKey(serverPrivateKey);
    
    // Create Arkiv wallet client and upload entity
    let uploadResult: UploadResponse;
    try {
      const walletClient = createArkivWalletClient(serverPrivateKey);
      const result = await uploadEntityToArkiv(walletClient, deviceEntity, ipfsHash);
      
      uploadResult = {
        entityKey: result.entityKey,
        txHash: result.txHash,
        ...(ipfsHash && { ipfsHash }), // Only include ipfsHash if it exists
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Check if it's an insufficient funds error
      if (errorMessage.includes('insufficient funds') || 
          errorMessage.includes('exceeds the balance') ||
          errorMessage.includes('balance of the account')) {
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
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
});

/**
 * POST /api/device/verify
 * Verify device signature without uploading
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { signature } = req.body;
    
    if (!signature || !signature.message || !signature.signature) {
      return res.status(400).json({ 
        error: 'Missing required fields: signature.message and signature.signature' 
      });
    }
    
    try {
      const deviceAddress = verifySignatureAndGetAddress(signature.message, signature.signature);
      
      res.status(200).json({
        success: true,
        deviceAddress,
      });
    } catch (error) {
      return res.status(401).json({ 
        error: `Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
  } catch (error) {
    console.error('Verify error:', error);
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
    
    res.status(200).json({
      success: true,
      count: chats.length,
      data: chats,
    });
  } catch (error) {
    console.error('Get chats error:', error);
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
    
    res.status(200).json({
      success: true,
      count: messages.length,
      data: messages,
    });
  } catch (error) {
    console.error('Get whistleblow messages error:', error);
    res.status(500).json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
});

export default router;

