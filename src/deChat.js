import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import DHT from 'bittorrent-dht';
import rateLimit from 'express-rate-limit';
// import https from 'https';
// import fs from 'fs';
import crypto from 'crypto';
import cors from 'cors';

// Configuration
const PORT = process.env.PORT || 8080;
const NODE_ID = `node-${PORT}`;
const dht = new DHT();
const app = express();
const peers = new Map(); // Stores known peers and their public keys
const MESSAGES = [];

// HTTPS Certificates (replace with valid certificates)
// const sslOptions = {
//   key: fs.readFileSync('key.pem'), // Private key
//   cert: fs.readFileSync('cert.pem'), // Certificate
// };

// Generate RSA Key Pair
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
console.log(`Public Key for Node ${NODE_ID}:\n${publicKey.export({ type: 'spki', format: 'pem' })}`);

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per minute
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// Helper: Sign a message
function signMessage(message) {
  return crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64');
}

// Helper: Verify a signed message
function verifySignature(message, signature, peerPublicKey) {
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(message),
      crypto.createPublicKey(peerPublicKey),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

// Helper: Encrypt a message
function encryptMessage(message, peerPublicKey) {
  return crypto.publicEncrypt(peerPublicKey, Buffer.from(message)).toString('base64');
}

// Helper: Decrypt a message
function decryptMessage(encryptedMessage) {
  return crypto.privateDecrypt(privateKey, Buffer.from(encryptedMessage, 'base64')).toString();
}

// Express Endpoints

// Endpoint to get the current node's public key and address
app.get('/address', (req, res) => {
  res.json({
    address: `https://localhost:${PORT}`,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  });
});

// Endpoint to verify peer discovery via challenge-response
app.post('/challenge', (req, res) => {
  console.log('Received challenge request:', req.body);
  const { challenge, publicKey: peerPublicKey } = req.body;

  if (!challenge || !peerPublicKey) {
    return res.status(400).json({ error: 'Invalid challenge request' });
  }

  const response = signMessage(challenge); // Sign the challenge with the private key
  res.status(200).json({ response });
});

// Endpoint to receive and decrypt messages
app.post('/message', (req, res) => {
  const { sender, encryptedMessage, signature, publicKey: peerPublicKey } = req.body;

  // Validate request
  if (!sender || !encryptedMessage || !signature || !peerPublicKey) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  // Verify the sender's signature
  const decryptedMessage = decryptMessage(encryptedMessage);
  if (!verifySignature(decryptedMessage, signature, peerPublicKey)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  console.log(`Message received from ${sender}: ${decryptedMessage}`);
  MESSAGES.push({ sender, message: decryptedMessage });

  // Add sender's public key to the peer list
  peers.set(sender, peerPublicKey);

  res.status(200).json({ status: 'Message received' });
});

// Start HTTPS Server
// https.createServer(sslOptions, app).listen(PORT, () => {
//   console.log(`Secure Express server running on https://localhost:${PORT}`);
// });
app.listen(PORT, () => {
  console.log(`Listening on Port ${PORT}...`);
});

// Start DHT Node
function startDHT() {
  const infoHash = Buffer.from('decentralized-node-discovery'); // Unique identifier for this network

  dht.listen(PORT, () => {
    console.log(`DHT node listening on port ${PORT}`);
  });

  // Announce the current node
  dht.announce(infoHash, PORT, () => {
    console.log(`Announced on DHT with infoHash ${infoHash.toString('hex')}`);
  });

  // Look for other nodes in the network
  dht.lookup(infoHash);

  // Handle discovered peers
  dht.on('peer', (peer, infoHash) => {
    const address = `https://${peer.host}:${peer.port}`;
    if (!peers.has(address)) {
      console.log(`Discovered peer: ${address}`);
      initiateChallenge(address);
    }
  });
}

// Function to initiate a challenge-response for peer verification
async function initiateChallenge(peerAddress) {
  console.log(`Initiating challenge to ${peerAddress}`);
  const challenge = crypto.randomBytes(32).toString('hex');
  try {
    const response = await axios.post(`${peerAddress}/challenge`, {
      challenge,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    });

    // Verify the challenge response
    const isValid = verifySignature(challenge, response.data.response, response.data.publicKey);
    if (isValid) {
      console.log(`Verified peer: ${peerAddress}`);
      peers.set(peerAddress, response.data.publicKey);
    } else {
      console.error(`Invalid response from peer: ${peerAddress}`);
    }
  } catch (error) {
    console.error(`Failed to verify peer: ${peerAddress} - ${error.message}`);
  }
}

// Function to send an encrypted message to another peer
export async function sendMessage(peerAddress, message) {
  const peerPublicKey = peers.get(peerAddress);
  if (!peerPublicKey) {
    console.error(`Unknown peer: ${peerAddress}`);
    return;
  }

  const encryptedMessage = encryptMessage(message, peerPublicKey);
  const signature = signMessage(message);

  try {
    const response = await axios.post(`${peerAddress}/message`, {
      sender: `https://localhost:${PORT}`,
      encryptedMessage,
      signature,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    });
    console.log(`Message sent to ${peerAddress}:`, response.data);
  } catch (error) {
    console.error(`Failed to send message to ${peerAddress}:`, error.message);
  }
}

// Start the DHT node
startDHT();
console.log(`Secure and verified decentralized peer discovery node running on port ${PORT}`);
