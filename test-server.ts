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
  
  // Test verify endpoint with first device
  results.verify = await testVerifyEndpoint(MOCK_DEVICES[0].privateKey);
  
  // Test upload without file for each device
  for (const device of MOCK_DEVICES) {
    const key = `upload-no-file-${device.name}`;
    results[key] = await testUploadWithoutFile(device.privateKey, device.name);
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Test upload with file (only first device to avoid too many IPFS uploads)
  results['upload-with-file'] = await testUploadWithFile(MOCK_DEVICES[0].privateKey, MOCK_DEVICES[0].name);
  
  // Test invalid signature
  results['invalid-signature'] = await testInvalidSignature();
  
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

