# Beacon Server

Express server for beacon device data upload to Arkiv network with IPFS file storage support.

## Features

- **Device Authentication**: Ed25519 signature verification (preferred), EVM personal_sign supported for legacy clients
- **Deterministic Wallet Generation**: PBKDF2 derives a per-device Arkiv-paying wallet from the device's pubkey hex (or EVM address) + a server-side salt
- **Arkiv Integration**: Upload device entities to the Arkiv network (Mendoza testnet by default)
- **IPFS File Storage**: Upload files to IPFS via Pinata and store the hash in the Arkiv entity payload
- **Rate Limited**: 30 req/min per IP on `/api/device/*` (env-tunable)
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
| `SERVER_SALT` | Salt for PBKDF2 wallet derivation. Generate once, never rotate. | Yes |
| `PINATA_API_KEY` | Pinata API key | Yes (for file uploads) |
| `PINATA_SECRET_KEY` | Pinata secret key | Yes (for file uploads) |
| `PORT` | Server port | No (default: 3000) |
| `NODE_ENV` | Standard Node convention | No (`development`) |
| `ARKIV_RPC_URL` | Arkiv RPC endpoint | No (default: Mendoza testnet) |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | No (default: `*`) |
| `LOG_LEVEL` | Winston log level | No (`info`) |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window | No (`60000`) |
| `RATE_LIMIT_MAX` | Max requests per window per IP | No (`30`) |
| `RATE_LIMIT_DISABLED` | Disable rate limiter (load tests only) | No |
| `ALLOW_BYPASS_SIGNATURE` | When `true`, accepts `bypassSignature=true` from clients. **Never enable in prod.** | No (`false`) |
| `MOCK_DEVICE_PRIVATE_KEY` | Override the dev mock key used when bypass is enabled | No |
| `DOMAIN` | Public hostname for Caddy / Let's Encrypt (compose only) | Yes (compose) |
| `ACME_EMAIL` | Contact email for Let's Encrypt (compose only) | Yes (compose) |

## Deploy on EC2 with HTTPS (docker-compose + Caddy)

The repo ships a `docker-compose.yml` + `Caddyfile` that runs the server behind
Caddy. Caddy auto-issues and renews a Let's Encrypt cert for your domain, so
the iOS app gets a real HTTPS endpoint with no manual cert handling.

### 1. Launch and prepare the EC2 instance

- AMI: Amazon Linux 2023, Ubuntu 22.04, or any modern Linux. `t3.small` is
  enough for testing; bump to `t3.medium` if BLE-spammy clients show up.
- **Security group inbound**:
  - TCP 22 from your IP (SSH)
  - TCP 80 from anywhere (Let's Encrypt HTTP-01 challenge — required)
  - TCP 443 from anywhere (HTTPS)
  - Do *not* expose 3000 publicly.
- **DNS**: Point an A record (e.g. `beacon.example.com`) at the instance's
  public IP. The cert won't issue until DNS resolves.

### 2. Install Docker

Amazon Linux 2023:
```bash
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
# log out / back in so the group takes effect
```

Ubuntu 22.04:
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

The Compose plugin ships with modern Docker. Verify with `docker compose version`.

### 3. Clone and configure

```bash
git clone <this-repo> beacon-server
cd beacon-server
cp .env.example .env
```

Edit `.env` and set, at minimum:
```env
DOMAIN=beacon.your-domain.com
ACME_EMAIL=ops@your-domain.com
SERVER_SALT=<openssl rand -hex 32>
PINATA_API_KEY=...
PINATA_SECRET_KEY=...
NODE_ENV=production
ALLOW_BYPASS_SIGNATURE=false
```

### 4. Bring it up

```bash
docker compose up -d --build
docker compose logs -f
```

First boot Caddy will fetch the cert; you should see `certificate obtained successfully` within ~30s. Once that's in, hit `https://$DOMAIN/health` from any browser — should return `{"status":"ok",...}`.

### 5. Point the iOS app at it

In `MeshBeacon/Configs/Local.xcconfig` (copy `Local.xcconfig.example` if missing):
```
BACKEND_BASE_URL = https:/$()/beacon.your-domain.com
```
The `$()` escapes the `//` from xcconfig comment parsing — required.

### 6. Fund the per-device wallets

Each device that uploads triggers PBKDF2 → a unique Arkiv-paying wallet. The 402 error response includes the wallet address and faucet URL; fund it once at https://mendoza.hoodi.arkiv.network/faucet/ and that device can publish from then on.

### Operational notes

- **Persistence**: SQLite (chat mirror) is on the named volume `beacon_data`,
  certs on `caddy_data`. Both survive `docker compose down`. Snapshot your
  EBS volume periodically.
- **Updates**: `git pull && docker compose up -d --build` — Caddy stays up,
  beacon container is rebuilt and rolled.
- **Logs**: `docker compose logs -f beacon` (app), `docker compose logs -f caddy`
  (HTTPS / Let's Encrypt).
- **Rotating SERVER_SALT**: don't. It changes every derived wallet, orphaning
  any funded ones. Generate once, store in a password manager.

## License

ISC
