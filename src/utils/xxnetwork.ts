import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { DeviceEntity } from '../types/index.js';

const execAsync = promisify(exec);

export interface XXNetworkResponse {
  dmPubKey?: string;
  dmToken?: string;
  dmRecvPubKey?: string;
  dmRecvToken?: string;
  userReceptionID?: string;
  networkStatus?: boolean;
  messageIds?: string[];
  roundIds?: number[];
  receivedMessages?: number;
}

/**
 * Parse xx-network output to extract relevant information
 */
function parseXXNetworkOutput(output: string): XXNetworkResponse {
  const result: XXNetworkResponse = {
    messageIds: [],
    roundIds: [],
    receivedMessages: 0,
  };

  const lines = output.split('\n');
  
  for (const line of lines) {
    // Extract DMPUBKEY
    if (line.startsWith('DMPUBKEY:')) {
      result.dmPubKey = line.replace('DMPUBKEY:', '').trim();
    }
    // Extract DMTOKEN
    else if (line.startsWith('DMTOKEN:')) {
      result.dmToken = line.replace('DMTOKEN:', '').trim();
    }
    // Extract DMRECVPUBKEY
    else if (line.startsWith('DMRECVPUBKEY:')) {
      result.dmRecvPubKey = line.replace('DMRECVPUBKEY:', '').trim();
    }
    // Extract DMRECVTOKEN
    else if (line.startsWith('DMRECVTOKEN:')) {
      result.dmRecvToken = line.replace('DMRECVTOKEN:', '').trim();
    }
    // Extract User ReceptionID
    else if (line.startsWith('User ReceptionID:')) {
      result.userReceptionID = line.replace('User ReceptionID:', '').trim();
    }
    // Extract Network Status
    else if (line.startsWith('Network Status:')) {
      const statusStr = line.replace('Network Status:', '').trim();
      result.networkStatus = statusStr === 'true';
    }
    // Extract DM Send message IDs and round IDs
    else if (line.startsWith('DM Send:')) {
      const match = line.match(/DM Send:\s*([^,]+),\s*(\d+),/);
      if (match) {
        result.messageIds?.push(match[1].trim());
        result.roundIds?.push(parseInt(match[2], 10));
      }
    }
    // Count received messages
    else if (line.includes('Message received')) {
      result.receivedMessages = (result.receivedMessages || 0) + 1;
    }
  }

  return result;
}

/**
 * Send a message to xx-network using the Go implementation
 * @param message - The message to send (will be JSON stringified if it's an object)
 * @returns Promise that resolves with parsed xx-network response data
 */
export async function sendToXXNetwork(message: DeviceEntity | string): Promise<XXNetworkResponse> {
  const xxNetworkDir = path.join(process.cwd(), 'xx-network');
  
  // Stringify the message if it's an object
  const messageString = typeof message === 'string' 
    ? message 
    : JSON.stringify(message);

  // Escape the message for shell execution (escape double quotes and backslashes)
  // Use double quotes in shell command to better handle JSON
  const escapedMessage = messageString
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/"/g, '\\"')    // Escape double quotes
    .replace(/\$/g, '\\$')   // Escape dollar signs
    .replace(/`/g, '\\`');   // Escape backticks

  // Build the command to run the Go program
  // Use double quotes to wrap the message for better JSON handling
  const command = `cd ${xxNetworkDir} && go run main.go -m "${escapedMessage}"`;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: xxNetworkDir,
      timeout: 90000, // 90 second timeout (increased for network registration)
    });

    // Combine stdout and stderr (Go program outputs to both)
    const combinedOutput = (stdout || '') + '\n' + (stderr || '');
    
    // Parse the output to extract relevant information
    const parsedData = parseXXNetworkOutput(combinedOutput);
    
    // Log the output for debugging
    console.log('xx-network output:', combinedOutput);
    
    return parsedData;
  } catch (error: any) {
    // The Go program might exit with non-zero code even on success
    // Check if it's a timeout or actual error
    if (error.code === 'ETIMEDOUT') {
      throw new Error('xx-network command timed out');
    }
    
    // Try to parse output even if there was an error (the Go program might have succeeded)
    const combinedOutput = (error.stdout || '') + '\n' + (error.stderr || '');
    const parsedData = parseXXNetworkOutput(combinedOutput);
    
    // If we got some data, return it (partial success)
    if (parsedData.dmPubKey || parsedData.messageIds?.length) {
      console.log('xx-network partial success, parsed data:', parsedData);
      return parsedData;
    }
    
    // Log the error but don't fail if it's just the Go program exiting
    // The Go implementation is flaky, so we'll be lenient
    console.error('xx-network command error:', error.message);
    
    // Only throw if it's a critical error (not just exit code)
    if (!error.stdout && !error.stderr) {
      throw new Error(`Failed to execute xx-network command: ${error.message}`);
    }
    
    // Return empty result if we couldn't parse anything
    return parsedData;
  }
}

