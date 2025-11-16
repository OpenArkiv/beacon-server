
create a express server typescript based. 
- needs to do the following:
- each device will be represented by a unique device public key - basically an EVM private key is on the device - it will sign a signature for a message payload and send this signature to this endpoint on the express server. the server endpoint will parse the wallet address from the signature and generate server side wallet using that wallet address as a seed and use a server salt,
- this wallet is then used as the walletclient to use Arkiv SDK for uploading data enitty to the arkiv network  (refer @Arkiv.llm.md to know how to use arkiv
- Use pinata and support IPFS upload on the backend, take in multipart image/file uploads - since the arkiv only allows text store, we store the hash of the image instead
eg. payload for the arkiv entity {
  "_id": "node_<uuid>",
  "nodeId": "node_<uuid>",        // canonical id
  "devicePub": "02ab...",        // compressed secp256k1 hex
  "location": { "lat": 12.34, "lon": 56.78 },  // last known (optional)
  "lastSeen": "2025-11-15T22:10:00Z",
  "storage": { "freeBytes": 123456, "quota": 1073741824 },
  "tags": ["field-team-1", "edge-gateway"]
}

Indexes: devicePub (unique), lastSeen.


@device.ts in the server rn the signature is mandatory for the endpoints, but when whistleblow flag is set, it should be anonymous, so signature shouldnt be mandatory - you wont need it anyway. make changes accordingly