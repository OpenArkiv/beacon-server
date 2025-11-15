import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

/**
 * Upload file to IPFS via Pinata
 */
export async function uploadToPinata(
  file: Express.Multer.File,
  metadata?: Record<string, any>
): Promise<string> {
  const pinataApiKey = process.env.PINATA_API_KEY;
  const pinataSecretKey = process.env.PINATA_SECRET_KEY;
  
  if (!pinataApiKey || !pinataSecretKey) {
    throw new Error('Pinata API credentials not configured');
  }
  
  if (!file.path) {
    throw new Error('File path is missing - file may not have been saved to disk');
  }
  
  if (!fs.existsSync(file.path)) {
    throw new Error(`File not found at path: ${file.path}`);
  }
  
  try {
    const formData = new FormData();
    
    // Add file
    formData.append('file', fs.createReadStream(file.path), {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    
    // Add metadata if provided
    if (metadata) {
      const pinataMetadata = JSON.stringify(metadata);
      formData.append('pinataMetadata', pinataMetadata);
    }
    
    // Add options
    const pinataOptions = JSON.stringify({
      cidVersion: 1,
    });
    formData.append('pinataOptions', pinataOptions);
    
    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        headers: {
          'pinata_api_key': pinataApiKey,
          'pinata_secret_api_key': pinataSecretKey,
          ...formData.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    
    // Return IPFS hash (CID)
    return response.data.IpfsHash;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Pinata upload failed: ${error.response?.data?.error || error.message}`);
    }
    throw error;
  }
}

/**
 * Clean up temporary file
 */
export function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`Failed to cleanup temp file ${filePath}:`, error);
  }
}

