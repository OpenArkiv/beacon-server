# Beacon Server

Express server for beacon device data upload to Arkiv network with IPFS file storage support.

## Features

- **Device Authentication**: Devices authenticate using EVM signature verification
- **Deterministic Wallet Generation**: Server generates wallets from device addresses using PBKDF2
- **Arkiv Integration**: Upload device entities to the Arkiv network
- **IPFS File Storage**: Upload files to IPFS via Pinata and store hash in Arkiv
- **TypeScript**: Fully typed Express server

## Prerequisites

- Node.js 18+ or Bun
- Pinata API credentials (for IPFS uploads)
- Arkiv testnet access (Mendoza)

## Installation

1. Install dependencies:
```bash
yarn install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Configure your environment variables:
```env
PORT=3000
SERVER_SALT=your-server-salt-here-change-in-production
ARKIV_RPC_URL=https://mendoza.hoodi.arkiv.network/rpc
ARKIV_WS_URL=wss://mendoza.hoodi.arkiv.network/rpc/ws
PINATA_API_KEY=your-pinata-api-key
PINATA_SECRET_KEY=your-pinata-secret-key
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

## Usage

### Development

```bash
yarn dev
```

### Production

```bash
yarn build
yarn start
```

### Testing

Run the test script to verify server functionality:

```bash
yarn test
```

The test script will:
- Test the health endpoint
- Test signature verification endpoint
- Test entity upload without file for multiple mock devices
- Test entity upload with file (IPFS)
- Test invalid signature rejection

Make sure the server is running before executing tests. You can set a custom server URL with:
```bash
SERVER_URL=http://localhost:3000 yarn test
```

## API Endpoints

### POST `/api/device/upload`

Upload device entity data to Arkiv network with optional file upload.

**Request:**
- Content-Type: `multipart/form-data`
- Body:
  - `entity` (JSON string): Device entity object
  - `signature` (JSON string): Signature payload with `message` and `signature`
  - `file` (optional): File to upload to IPFS

**Example Entity:**
```json
{
  "_id": "node_<uuid>",
  "nodeId": "node_<uuid>",
  "devicePub": "02ab...",
  "location": { "lat": 12.34, "lon": 56.78 },
  "lastSeen": "2025-11-15T22:10:00Z",
  "storage": { "freeBytes": 123456, "quota": 1073741824 },
  "tags": ["field-team-1", "edge-gateway"]
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "entityKey": "...",
    "txHash": "...",
    "ipfsHash": "..." // if file was uploaded
  }
}
```

**Response (Insufficient Funds - 402):**
```json
{
  "error": "Insufficient funds: The server wallet does not have enough funds to execute this transaction.",
  "walletAddress": "0x413264d93a99CFD5B2159B2DA1109Bad02301AE6",
  "message": "Please fund the wallet address: 0x413264d93a99CFD5B2159B2DA1109Bad02301AE6",
  "faucetUrl": "https://mendoza.hoodi.arkiv.network/faucet/"
}
```

**Response (Other Errors - 500):**
```json
{
  "error": "Arkiv upload failed: ...",
  "walletAddress": "0x..." // Included for debugging
}
```

### POST `/api/device/verify`

Verify device signature without uploading.

**Request:**
```json
{
  "signature": {
    "message": "message to verify",
    "signature": "0x..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "deviceAddress": "0x..."
}
```

### GET `/health`

Health check endpoint.

## Architecture

### Device Authentication Flow

1. Device signs a message with its EVM private key
2. Server verifies signature and extracts device address
3. Server generates deterministic wallet from device address + server salt using PBKDF2
4. Server uses generated wallet to interact with Arkiv network

### File Upload Flow

1. Device uploads file via multipart form data
2. Server uploads file to IPFS via Pinata
3. Server stores IPFS hash in Arkiv entity payload
4. Temporary file is cleaned up

## Project Structure

```
src/
├── index.ts              # Express app entry point
├── routes/
│   └── device.ts         # Device API routes
├── middleware/
│   └── upload.ts         # Multer file upload configuration
├── utils/
│   ├── signature.ts      # Signature verification & wallet generation
│   ├── arkiv.ts          # Arkiv SDK integration
│   └── ipfs.ts           # Pinata IPFS upload
└── types/
    └── index.ts          # TypeScript type definitions
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3000) |
| `SERVER_SALT` | Salt for wallet generation | Yes |
| `ARKIV_RPC_URL` | Arkiv RPC endpoint | No (default: Mendoza testnet) |
| `ARKIV_WS_URL` | Arkiv WebSocket endpoint | No |
| `PINATA_API_KEY` | Pinata API key | Yes (for file uploads) |
| `PINATA_SECRET_KEY` | Pinata secret key | Yes (for file uploads) |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | No |

## License

ISC
