import crypto from 'crypto';

export const MULTICAST_ADDRESS = '239.255.255.250';
export const MULTICAST_PORT = 41234;
export const BROADCAST_INTERVAL = 2000;
export const PEER_TIMEOUT = 10000;

export const AES_KEY = crypto.randomBytes(32); // AES-256 key
export const SECRET_KEY = 'shared_secret_key'; // Shared HMAC key
export const PEER_NAME = `Peer-${Math.floor(Math.random() * 1000)}`;

// TLS configuration
export const TLS_CERT_PATH = './cert.pem';
export const TLS_KEY_PATH = './key.pem';

export const INFO_HASH = '12345abcde67890fghij12345abcde67890fghij'; // Replace with your unique infoHash
