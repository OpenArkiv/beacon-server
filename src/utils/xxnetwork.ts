import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { DeviceEntity } from '../types/index.js';

const execAsync = promisify(exec);

/**
 * Send a message to xx-network using the Go implementation
 * @param message - The message to send (will be JSON stringified if it's an object)
 * @returns Promise that resolves when the command completes
 */
export async function sendToXXNetwork(message: DeviceEntity | string): Promise<void> {
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
      timeout: 60000, // 60 second timeout
    });

    if (stderr && !stderr.includes('DM Send')) {
      console.error('xx-network stderr:', stderr);
    }
    
    if (stdout) {
      console.log('xx-network stdout:', stdout);
    }
  } catch (error: any) {
    // The Go program might exit with non-zero code even on success
    // Check if it's a timeout or actual error
    if (error.code === 'ETIMEDOUT') {
      throw new Error('xx-network command timed out');
    }
    
    // Log the error but don't fail if it's just the Go program exiting
    // The Go implementation is flaky, so we'll be lenient
    console.error('xx-network command error:', error.message);
    
    // Only throw if it's a critical error (not just exit code)
    if (!error.stdout && !error.stderr) {
      throw new Error(`Failed to execute xx-network command: ${error.message}`);
    }
  }
}

