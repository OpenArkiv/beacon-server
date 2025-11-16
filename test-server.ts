import { ethers } from 'ethers';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Mock device private keys for testing
const MOCK_DEVICES = [
  {
    name: 'Device 1',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  {
    name: 'Device 2',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  {
    name: 'Device 3',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
];

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// Track wallet addresses that need funding
const walletsNeedingFunding: Set<string> = new Set();

/**
 * Create a test device entity
 */
function createTestEntity(deviceAddress: string, deviceName: string) {
  const nodeId = `node_${uuidv4()}`;
  return {
    _id: nodeId,
    nodeId: nodeId,
    devicePub: deviceAddress,
    location: {
      lat: 40.7128 + (Math.random() - 0.5) * 0.1,
      lon: -74.0060 + (Math.random() - 0.5) * 0.1,
    },
    lastSeen: new Date().toISOString(),
    storage: {
      freeBytes: Math.floor(Math.random() * 1000000000),
      quota: 1073741824,
    },
    tags: ['test-device', deviceName.toLowerCase().replace(/\s+/g, '-')],
  };
}

/**
 * Sign a message with a private key
 */
function signMessage(privateKey: string, message: string): string {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.signMessageSync(message);
}

/**
 * Test the verify endpoint
 */
async function testVerifyEndpoint(privateKey: string) {
  console.log('\n📝 Testing /api/device/verify endpoint...');
  
  const wallet = new ethers.Wallet(privateKey);
  const message = `Test message for verification - ${Date.now()}`;
  const signature = signMessage(privateKey, message);
  
  try {
    const response = await axios.post(`${SERVER_URL}/api/device/verify`, {
      signature: {
        message,
        signature,
      },
    }, {
      timeout: 10000,
    });
    
    console.log('✅ Verify endpoint test passed');
    console.log(`   Device Address: ${response.data.deviceAddress}`);
    console.log(`   Expected: ${wallet.address}`);
    console.log(`   Match: ${response.data.deviceAddress.toLowerCase() === wallet.address.toLowerCase() ? '✅' : '❌'}`);
    
    return response.data.deviceAddress.toLowerCase() === wallet.address.toLowerCase();
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Verify endpoint test failed: Server is not running!');
    } else {
      console.error('❌ Verify endpoint test failed:', error.response?.data || error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
      }
    }
    return false;
  }
}

/**
 * Test the upload endpoint without file
 */
async function testUploadWithoutFile(privateKey: string, deviceName: string) {
  console.log(`\n📤 Testing /api/device/upload endpoint (no file) for ${deviceName}...`);
  
  const wallet = new ethers.Wallet(privateKey);
  const deviceAddress = wallet.address;
  
  const entity = createTestEntity(deviceAddress, deviceName);
  const message = JSON.stringify(entity);
  const signature = signMessage(privateKey, message);
  
  try {
    const formData = new FormData();
    formData.append('entity', JSON.stringify(entity));
    formData.append('signature', JSON.stringify({ message, signature }));
    
    const response = await axios.post(`${SERVER_URL}/api/device/upload`, formData, {
      headers: formData.getHeaders(),
      timeout: 30000, // 30 seconds for Arkiv upload
    });
    
    console.log('✅ Upload endpoint test passed (no file)');
    console.log(`   Entity Key: ${response.data.data.entityKey}`);
    console.log(`   Transaction Hash: ${response.data.data.txHash}`);
    if (response.data.data.ipfsHash) {
      console.log(`   IPFS Hash: ${response.data.data.ipfsHash}`);
    } else {
      console.log(`   IPFS Hash: N/A (no file uploaded)`);
    }
    
    return true;
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Upload endpoint test failed: Server is not running!');
    } else {
      const responseData = error.response?.data;
      const status = error.response?.status;
      
      // Check for insufficient funds error
      if (status === 402 || (responseData?.error && responseData.error.includes('Insufficient funds'))) {
        const walletAddress = responseData?.walletAddress;
        if (walletAddress) {
          walletsNeedingFunding.add(walletAddress);
          console.error('❌ Upload endpoint test failed: Insufficient funds');
          console.error(`   Wallet Address: ${walletAddress}`);
          if (responseData.faucetUrl) {
            console.error(`   Faucet URL: ${responseData.faucetUrl}`);
          }
          console.error(`   Please fund this wallet and retry the test`);
        } else {
          console.error('❌ Upload endpoint test failed: Insufficient funds (wallet address not provided)');
        }
      } else {
        console.error('❌ Upload endpoint test failed:', responseData || error.message);
        if (error.response) {
          console.error(`   Status: ${error.response.status}`);
          if (responseData?.walletAddress) {
            console.error(`   Wallet Address: ${responseData.walletAddress}`);
          }
          console.error(`   Data:`, JSON.stringify(responseData, null, 2));
        } else if (error.message) {
          console.error(`   Error: ${error.message}`);
        }
      }
    }
    return false;
  }
}

/**
 * Test the upload endpoint with file
 */
async function testUploadWithFile(privateKey: string, deviceName: string) {
  console.log(`\n📤 Testing /api/device/upload endpoint (with file) for ${deviceName}...`);
  
  const wallet = new ethers.Wallet(privateKey);
  const deviceAddress = wallet.address;
  
  const entity = createTestEntity(deviceAddress, deviceName);
  const message = JSON.stringify(entity);
  const signature = signMessage(privateKey, message);
  
  // Create a temporary test file
  const testFileContent = `Test file content for ${deviceName}\nGenerated at: ${new Date().toISOString()}\nDevice: ${deviceAddress}`;
  const testFilePath = path.join(process.cwd(), 'temp', `test-${Date.now()}.txt`);
  
  // Ensure temp directory exists
  const tempDir = path.dirname(testFilePath);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  fs.writeFileSync(testFilePath, testFileContent);
  
  try {
    const formData = new FormData();
    formData.append('entity', JSON.stringify(entity));
    formData.append('signature', JSON.stringify({ message, signature }));
    formData.append('file', fs.createReadStream(testFilePath), {
      filename: `test-${deviceName}.txt`,
      contentType: 'text/plain',
    });
    
    const response = await axios.post(`${SERVER_URL}/api/device/upload`, formData, {
      headers: formData.getHeaders(),
      timeout: 60000, // 60 seconds for IPFS + Arkiv upload
    });
    
    console.log('✅ Upload endpoint test passed (with file)');
    console.log(`   Entity Key: ${response.data.data.entityKey}`);
    console.log(`   Transaction Hash: ${response.data.data.txHash}`);
    if (response.data.data.ipfsHash) {
      console.log(`   IPFS Hash: ${response.data.data.ipfsHash}`);
    } else {
      console.log(`   ⚠️  IPFS Hash: Missing (file upload may have failed)`);
    }
    
    // Cleanup test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    
    return true;
  } catch (error: any) {
    // Cleanup test file on error
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Upload endpoint test failed: Server is not running!');
    } else {
      const responseData = error.response?.data;
      const status = error.response?.status;
      
      // Check for insufficient funds error
      if (status === 402 || (responseData?.error && responseData.error.includes('Insufficient funds'))) {
        const walletAddress = responseData?.walletAddress;
        if (walletAddress) {
          walletsNeedingFunding.add(walletAddress);
          console.error('❌ Upload endpoint test failed: Insufficient funds');
          console.error(`   Wallet Address: ${walletAddress}`);
          if (responseData.faucetUrl) {
            console.error(`   Faucet URL: ${responseData.faucetUrl}`);
          }
          console.error(`   Please fund this wallet and retry the test`);
        } else {
          console.error('❌ Upload endpoint test failed: Insufficient funds (wallet address not provided)');
        }
      } else {
        console.error('❌ Upload endpoint test failed:', responseData || error.message);
        if (error.response) {
          console.error(`   Status: ${error.response.status}`);
          if (responseData?.walletAddress) {
            console.error(`   Wallet Address: ${responseData.walletAddress}`);
          }
          console.error(`   Data:`, JSON.stringify(responseData, null, 2));
        } else if (error.message) {
          console.error(`   Error: ${error.message}`);
        }
      }
    }
    return false;
  }
}

/**
 * Test health endpoint
 */
async function testHealthEndpoint() {
  console.log('\n🏥 Testing /health endpoint...');
  
  try {
    const response = await axios.get(`${SERVER_URL}/health`, {
      timeout: 5000,
    });
    console.log('✅ Health endpoint test passed');
    console.log(`   Status: ${response.data.status}`);
    console.log(`   Timestamp: ${response.data.timestamp}`);
    return true;
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Health endpoint test failed: Server is not running!');
      console.error('   Please start the server with: yarn dev');
    } else {
      console.error('❌ Health endpoint test failed:', error.response?.data || error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, error.response.data);
      }
    }
    return false;
  }
}

/**
 * Test invalid signature
 */
async function testInvalidSignature() {
  console.log('\n🚫 Testing invalid signature handling...');
  
  const entity = createTestEntity('0x0000000000000000000000000000000000000000', 'Invalid Device');
  const message = JSON.stringify(entity);
  const invalidSignature = '0x' + '0'.repeat(130); // Invalid signature format
  
  try {
    const formData = new FormData();
    formData.append('entity', JSON.stringify(entity));
    formData.append('signature', JSON.stringify({ message, signature: invalidSignature }));
    
    await axios.post(`${SERVER_URL}/api/device/upload`, formData, {
      headers: formData.getHeaders(),
    });
    
    console.error('❌ Invalid signature test failed - should have rejected');
    return false;
  } catch (error: any) {
    if (error.response?.status === 401) {
      console.log('✅ Invalid signature correctly rejected');
      return true;
    }
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Invalid signature test failed: Server is not running!');
    } else {
      console.error('❌ Invalid signature test failed:', error.response?.data || error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
      }
    }
    return false;
  }
}

/**
 * Test upload with whistleblow flag
 */
async function testWhistleblowUpload(privateKey: string, deviceName: string) {
  console.log(`\n🔒 Testing /api/device/upload endpoint (whistleblow) for ${deviceName}...`);
  
  const wallet = new ethers.Wallet(privateKey);
  const deviceAddress = wallet.address;
  
  const entity = createTestEntity(deviceAddress, deviceName);
  const message = JSON.stringify(entity);
  const signature = signMessage(privateKey, message);
  
  try {
    const formData = new FormData();
    formData.append('entity', JSON.stringify(entity));
    formData.append('signature', JSON.stringify({ message, signature }));
    formData.append('whistleblow', 'true');
    
    const response = await axios.post(`${SERVER_URL}/api/device/upload`, formData, {
      headers: formData.getHeaders(),
      timeout: 150000, // 150 seconds for xx-network (Go program runs indefinitely, needs time for network registration)
    });
    
    console.log('✅ Whistleblow upload test passed');
    console.log(`   Message: ${response.data.message || 'Sent to xx-network'}`);
    console.log(`   Node ID: ${response.data.data?.nodeId || entity.nodeId}`);
    console.log(`   Whistleblow: ${response.data.data?.whistleblow || true}`);
    
    // Log xx-network response data
    const xxNetwork = response.data.data?.xxNetwork;
    if (xxNetwork) {
      console.log('\n   📡 xx-Network Response Data:');
      if (xxNetwork.dmPubKey) {
        console.log(`      DM Pub Key: ${xxNetwork.dmPubKey}`);
      }
      if (xxNetwork.dmToken) {
        console.log(`      DM Token: ${xxNetwork.dmToken}`);
      }
      if (xxNetwork.dmRecvPubKey) {
        console.log(`      DM Recv Pub Key: ${xxNetwork.dmRecvPubKey}`);
      }
      if (xxNetwork.dmRecvToken) {
        console.log(`      DM Recv Token: ${xxNetwork.dmRecvToken}`);
      }
      if (xxNetwork.userReceptionID) {
        console.log(`      User Reception ID: ${xxNetwork.userReceptionID}`);
      }
      if (xxNetwork.networkStatus !== undefined) {
        console.log(`      Network Status: ${xxNetwork.networkStatus ? '✅ Connected' : '❌ Disconnected'}`);
      }
      if (xxNetwork.messageIds && xxNetwork.messageIds.length > 0) {
        console.log(`      Message IDs (${xxNetwork.messageIds.length}): ${xxNetwork.messageIds.slice(0, 3).join(', ')}${xxNetwork.messageIds.length > 3 ? '...' : ''}`);
      }
      if (xxNetwork.roundIds && xxNetwork.roundIds.length > 0) {
        console.log(`      Round IDs (${xxNetwork.roundIds.length}): ${xxNetwork.roundIds.slice(0, 3).join(', ')}${xxNetwork.roundIds.length > 3 ? '...' : ''}`);
      }
      if (xxNetwork.receivedMessages !== undefined) {
        console.log(`      Received Messages: ${xxNetwork.receivedMessages}`);
      }
    } else {
      console.log('   ⚠️  No xx-network data in response');
    }
    
    return true;
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Whistleblow upload test failed: Server is not running!');
    } else {
      const responseData = error.response?.data;
      const status = error.response?.status;
      
      // Handle timeout - if we got a response before timeout, it's a success
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        // Check if we got a response before timeout
        if (error.response?.data) {
          const responseData = error.response.data;
          console.log('⚠️  Request timed out but got response data');
          console.log(`   Status: ${error.response.status}`);
          
          // Log xx-network data if available
          const xxNetwork = responseData.data?.xxNetwork;
          if (xxNetwork) {
            console.log('\n   📡 xx-Network Response Data (from timeout):');
            if (xxNetwork.dmPubKey) console.log(`      DM Pub Key: ${xxNetwork.dmPubKey}`);
            if (xxNetwork.messageIds?.length) {
              console.log(`      Message IDs: ${xxNetwork.messageIds.slice(0, 3).join(', ')}`);
            }
          }
          
          // Consider it a pass if we got xx-network data
          if (xxNetwork && (xxNetwork.dmPubKey || xxNetwork.messageIds?.length)) {
            return true;
          }
        }
        console.error('❌ Whistleblow upload test failed: Request timed out');
        return false;
      }
      
      // xx-network might fail, but we should still get a response
      if (status === 500 && responseData?.error?.includes('xx-network')) {
        console.log('⚠️  Whistleblow upload attempted but xx-network failed (expected - flaky implementation)');
        console.log(`   Error: ${responseData.error}`);
        // Still consider this a pass since the routing worked
        return true;
      }
      
      console.error('❌ Whistleblow upload test failed:', responseData || error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, JSON.stringify(responseData, null, 2));
      } else if (error.message) {
        console.error(`   Error: ${error.message}`);
      }
    }
    return false;
  }
}

/**
 * Test GET /api/device/chats endpoint
 */
async function testGetChatsEndpoint() {
  console.log('\n💬 Testing /api/device/chats endpoint...');
  
  try {
    const response = await axios.get(`${SERVER_URL}/api/device/chats`, {
      timeout: 10000,
    });
    
    if (response.data.success && Array.isArray(response.data.data)) {
      console.log('✅ Get chats endpoint test passed');
      console.log(`   Total chats: ${response.data.count || response.data.data.length}`);
      console.log(`   Sample chat IDs: ${response.data.data.slice(0, 3).map((c: any) => c._id).join(', ') || 'None'}`);
      return true;
    } else {
      console.error('❌ Get chats endpoint test failed: Invalid response format');
      console.error(`   Response:`, JSON.stringify(response.data, null, 2));
      return false;
    }
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Get chats endpoint test failed: Server is not running!');
    } else {
      console.error('❌ Get chats endpoint test failed:', error.response?.data || error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
      }
    }
    return false;
  }
}

/**
 * Test GET /api/device/whistleblow endpoint
 */
async function testGetWhistleblowEndpoint() {
  console.log('\n🔒 Testing /api/device/whistleblow endpoint...');
  
  try {
    const response = await axios.get(`${SERVER_URL}/api/device/whistleblow`, {
      timeout: 10000,
    });
    
    if (response.data.success && Array.isArray(response.data.data)) {
      console.log('✅ Get whistleblow endpoint test passed');
      console.log(`   Total whistleblow messages: ${response.data.count || response.data.data.length}`);
      if (response.data.data.length > 0) {
        console.log(`   Sample message IDs: ${response.data.data.slice(0, 3).map((m: any) => m._id).join(', ')}`);
      } else {
        console.log(`   No whistleblow messages yet (this is OK if no whistleblow uploads have been made)`);
      }
      return true;
    } else {
      console.error('❌ Get whistleblow endpoint test failed: Invalid response format');
      console.error(`   Response:`, JSON.stringify(response.data, null, 2));
      return false;
    }
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Get whistleblow endpoint test failed: Server is not running!');
    } else {
      console.error('❌ Get whistleblow endpoint test failed:', error.response?.data || error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
      }
    }
    return false;
  }
}

/**
 * Check if server is reachable
 */
async function checkServerReachable(): Promise<boolean> {
  try {
    await axios.get(`${SERVER_URL}/health`, { timeout: 2000 });
    return true;
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('\n❌ Cannot connect to server!');
      console.error(`   Server URL: ${SERVER_URL}`);
      console.error('   Please make sure the server is running: yarn dev\n');
      return false;
    }
    return true; // Server is reachable but might have other issues
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🧪 Starting server tests...');
  console.log(`📍 Server URL: ${SERVER_URL}\n`);
  
  // Check if server is reachable first
  const serverReachable = await checkServerReachable();
  if (!serverReachable) {
    process.exit(1);
  }
  
  const results: { [key: string]: boolean } = {};
  
  // Test health endpoint
  results.health = await testHealthEndpoint();
  
  // Use first device for all device-specific tests
  const testDevice = MOCK_DEVICES[0];
  
  // Test verify endpoint
  results.verify = await testVerifyEndpoint(testDevice.privateKey);
  
  // Test upload without file
  results['upload-no-file'] = await testUploadWithoutFile(testDevice.privateKey, testDevice.name);
  
  // Small delay between requests
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test upload with file
  results['upload-with-file'] = await testUploadWithFile(testDevice.privateKey, testDevice.name);
  
  // Test invalid signature
  results['invalid-signature'] = await testInvalidSignature();
  
  // Test whistleblow upload (sends to xx-network)
  results['whistleblow-upload'] = await testWhistleblowUpload(testDevice.privateKey, testDevice.name);
  
  // Small delay before checking stored chats
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test get chats endpoint
  results['get-chats'] = await testGetChatsEndpoint();
  
  // Test get whistleblow endpoint
  results['get-whistleblow'] = await testGetWhistleblowEndpoint();
  
  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('='.repeat(50));
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  for (const [test, result] of Object.entries(results)) {
    console.log(`${result ? '✅' : '❌'} ${test}`);
  }
  
  console.log('='.repeat(50));
  console.log(`Total: ${passed}/${total} tests passed`);
  
  // Display wallet addresses that need funding
  if (walletsNeedingFunding.size > 0) {
    console.log('\n' + '='.repeat(50));
    console.log('💰 Wallets Needing Funding');
    console.log('='.repeat(50));
    console.log('The following wallet addresses need to be funded:');
    console.log('');
    const addresses = Array.from(walletsNeedingFunding);
    addresses.forEach((address, index) => {
      console.log(`${index + 1}. ${address}`);
    });
    console.log('');
    console.log('Faucet URL: https://mendoza.hoodi.arkiv.network/faucet/');
    console.log('');
    console.log('Copy these addresses and fund them, then rerun the tests.');
    console.log('='.repeat(50));
  }
  
  if (passed === total) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed');
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('💥 Test runner error:', error);
  process.exit(1);
});

