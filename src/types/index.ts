export interface DeviceEntity {
  _id: string;
  nodeId: string;
  devicePub: string; // compressed secp256k1 hex
  location?: {
    lat: number;
    lon: number;
  };
  lastSeen: string; // ISO 8601 timestamp
  storage?: {
    freeBytes: number;
    quota: number;
  };
  tags?: string[];
  text: string;
}

export interface SignaturePayload {
  message: string;
  signature: string;
}

export interface UploadResponse {
  entityKey: string;
  txHash: string;
  ipfsHash?: string;
}

export interface FileUploadRequest {
  entity: DeviceEntity;
  signature: SignaturePayload;
  file?: Express.Multer.File;
  whistleblow?: boolean;
}

