import express, { Request, Response } from 'express';
import { verifySignatureAndGetAddress, generateServerWalletFromAddress } from '../utils/signature.js';
import { createArkivWalletClient, uploadEntityToArkiv, getWalletAddressFromPrivateKey } from '../utils/arkiv.js';
import { uploadToPinata, cleanupTempFile } from '../utils/ipfs.js';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceEntity, FileUploadRequest, UploadResponse } from '../types/index.js';

const router = express.Router();

/**
 * POST /api/device/upload
 * Upload device entity data to Arkiv network
 * Supports optional file upload to IPFS
 */
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    
    // Parse JSON fields from multipart form data
    let entity: DeviceEntity;
    let signature: { message: string; signature: string };
    
    try {
      entity = typeof req.body.entity === 'string' 
        ? JSON.parse(req.body.entity) 
        : req.body.entity;
      signature = typeof req.body.signature === 'string'
        ? JSON.parse(req.body.signature)
        : req.body.signature;
    } catch (parseError) {
      return res.status(400).json({ 
        error: 'Invalid JSON in entity or signature fields' 
      });
    }
    
    // Validate required fields
    if (!entity || !signature) {
      return res.status(400).json({ 
        error: 'Missing required fields: entity and signature are required' 
      });
    }
    
    if (!signature.message || !signature.signature) {
      return res.status(400).json({ 
        error: 'Signature must include message and signature fields' 
      });
    }
    
    // Verify signature and get device address
    let deviceAddress: string;
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
    
    let serverPrivateKey: string;
    try {
      serverPrivateKey = generateServerWalletFromAddress(deviceAddress, serverSalt);
    } catch (error) {
      return res.status(500).json({ 
        error: `Failed to generate server wallet: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
    
    // Validate and prepare entity
    const deviceEntity: DeviceEntity = {
      _id: entity._id || `node_${uuidv4()}`,
      nodeId: entity.nodeId || entity._id || `node_${uuidv4()}`,
      devicePub: entity.devicePub || deviceAddress,
      location: entity.location,
      lastSeen: entity.lastSeen || new Date().toISOString(),
      storage: entity.storage,
      tags: entity.tags || [],
    };
    
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

export default router;

