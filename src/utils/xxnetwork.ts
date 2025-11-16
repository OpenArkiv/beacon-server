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
    // Extract Network Status (take the last true status)
    else if (line.startsWith('Network Status:')) {
      const statusStr = line.replace('Network Status:', '').trim();
      const isConnected = statusStr === 'true';
      // Only update if we haven't seen a true status yet, or if this is true
      if (isConnected || result.networkStatus === undefined) {
        result.networkStatus = isConnected;
      }
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
    // Extract final received message count from summary line
    else if (line.match(/Received \d+\/\d+ messages/)) {
      const match = line.match(/Received (\d+)\/\d+ messages/);
      if (match) {
        result.receivedMessages = parseInt(match[1], 10);
      }
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
  
  console.log('[xx-network] Starting xx-network message send...');
  console.log(`[xx-network] Working directory: ${xxNetworkDir}`);
  
  // Stringify the message if it's an object
  const messageString = typeof message === 'string' 
    ? message 
    : JSON.stringify(message);

  console.log(`[xx-network] Message to send (length: ${messageString.length}):`, 
    messageString.length > 200 ? messageString.substring(0, 200) + '...' : messageString);

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

  console.log(`[xx-network] Executing Go command...`);
  console.log(`[xx-network] Command: go run main.go -m "<message>" (in ${xxNetworkDir})`);
  console.log(`[xx-network] Timeout: 120 seconds`);

  try {
    const startTime = Date.now();
    const { stdout, stderr } = await execAsync(command, {
      cwd: xxNetworkDir,
      timeout: 120000, // 120 second timeout (Go program runs indefinitely, but we need time for network registration and first message send)
    });
    const executionTime = Date.now() - startTime;

    console.log(`[xx-network] Go command completed in ${executionTime}ms`);
    console.log(`[xx-network] stdout length: ${stdout?.length || 0} bytes`);
    console.log(`[xx-network] stderr length: ${stderr?.length || 0} bytes`);

    // Combine stdout and stderr (Go program outputs to both)
    const combinedOutput = (stdout || '') + '\n' + (stderr || '');
    
    console.log(`[xx-network] Combined output length: ${combinedOutput.length} bytes`);
    console.log(`[xx-network] First 500 chars of output:`, combinedOutput.substring(0, 500));
    
    // Parse the output to extract relevant information
    const parsedData = parseXXNetworkOutput(combinedOutput);
    
    console.log(`[xx-network] Parsed data:`, {
      hasDmPubKey: !!parsedData.dmPubKey,
      hasDmToken: !!parsedData.dmToken,
      hasUserReceptionID: !!parsedData.userReceptionID,
      networkStatus: parsedData.networkStatus,
      messageIdsCount: parsedData.messageIds?.length || 0,
      roundIdsCount: parsedData.roundIds?.length || 0,
      receivedMessages: parsedData.receivedMessages,
    });
    
    if (parsedData.dmPubKey) {
      console.log(`[xx-network] ✅ Successfully extracted DM Pub Key: ${parsedData.dmPubKey.substring(0, 20)}...`);
    }
    if (parsedData.messageIds && parsedData.messageIds.length > 0) {
      console.log(`[xx-network] ✅ Successfully sent ${parsedData.messageIds.length} message(s)`);
      parsedData.messageIds.slice(0, 3).forEach((msgId, idx) => {
        console.log(`[xx-network]   Message ${idx + 1}: ${msgId}`);
      });
    }
    
    return parsedData;
  } catch (error: any) {
    console.log(`[xx-network] ⚠️  Go command threw an error: ${error.code || 'UNKNOWN'}`);
    console.log(`[xx-network] Error message: ${error.message}`);
    
    // Try to parse output even if there was an error (the Go program might have succeeded)
    const combinedOutput = (error.stdout || '') + '\n' + (error.stderr || '');
    
    console.log(`[xx-network] Error stdout length: ${error.stdout?.length || 0} bytes`);
    console.log(`[xx-network] Error stderr length: ${error.stderr?.length || 0} bytes`);
    
    if (combinedOutput.length > 0) {
      console.log(`[xx-network] First 500 chars of error output:`, combinedOutput.substring(0, 500));
    }
    
    const parsedData = parseXXNetworkOutput(combinedOutput);
    
    console.log(`[xx-network] Parsed data from error output:`, {
      hasDmPubKey: !!parsedData.dmPubKey,
      hasDmToken: !!parsedData.dmToken,
      hasUserReceptionID: !!parsedData.userReceptionID,
      networkStatus: parsedData.networkStatus,
      messageIdsCount: parsedData.messageIds?.length || 0,
      roundIdsCount: parsedData.roundIds?.length || 0,
      receivedMessages: parsedData.receivedMessages,
    });
    
    // If we got some data (especially if we saw a DM Send), return it as success
    // The Go program runs indefinitely, so timeout is expected
    if (parsedData.dmPubKey || parsedData.messageIds?.length || parsedData.userReceptionID) {
      console.log('[xx-network] ✅ Succeeded despite error (timeout expected - program runs indefinitely)');
      if (parsedData.dmPubKey) {
        console.log(`[xx-network]   DM Pub Key: ${parsedData.dmPubKey.substring(0, 20)}...`);
      }
      if (parsedData.messageIds && parsedData.messageIds.length > 0) {
        console.log(`[xx-network]   Sent ${parsedData.messageIds.length} message(s)`);
      }
      return parsedData;
    }
    
    // If it's a timeout and we have no data, that's a real problem
    if (error.code === 'ETIMEDOUT' && !parsedData.dmPubKey && !parsedData.messageIds?.length) {
      console.error('[xx-network] ❌ Command timed out with no useful data');
      console.error(`[xx-network] Timeout after 120 seconds, no DM keys or message IDs found`);
      throw new Error('xx-network command timed out without receiving any data');
    }
    
    // Log the error but don't fail if it's just the Go program exiting
    // The Go implementation is flaky, so we'll be lenient
    console.error(`[xx-network] ⚠️  Command error (code: ${error.code}):`, error.message);
    
    // Only throw if it's a critical error (not just exit code)
    if (!error.stdout && !error.stderr) {
      console.error('[xx-network] ❌ Critical error: No output captured');
      throw new Error(`Failed to execute xx-network command: ${error.message}`);
    }
    
    console.log('[xx-network] Returning parsed data (may be empty)');
    // Return parsed data even if empty (better than throwing)
    return parsedData;
  }
}

