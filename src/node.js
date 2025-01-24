import dgram from 'dgram';
import crypto from 'crypto';

// Configuration
const MULTICAST_ADDRESS = '239.255.255.250'; // Multicast group address
const MULTICAST_PORT = 41234; // Multicast port
const BROADCAST_INTERVAL = 2000; // Interval for broadcasting presence (milliseconds)
const PEER_TIMEOUT = 10000; // Time to wait before removing inactive peers (milliseconds)
const SECRET_KEY = 'shared_secret_key'; // Shared key for authentication
const PEER_NAME = `Peer-${Math.floor(Math.random() * 1000)}`; // Unique identifier for the peer

// Create a UDP socket
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

// Store discovered peers with timestamps
const discoveredPeers = new Map();

// Generate an HMAC for secure communication
function generateHMAC(message) {
  return crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex');
}

// Broadcast presence to the network
function broadcastPresence() {
  const payload = `${PEER_NAME}|${Date.now()}`;
  const hmac = generateHMAC(payload);
  const message = Buffer.from(`${payload}|${hmac}`);
  socket.send(message, 0, message.length, MULTICAST_PORT, MULTICAST_ADDRESS, (err) => {
    if (err) console.error('Error broadcasting:', err);
  });
}

// Handle incoming messages
socket.on('message', (msg, rinfo) => {
  const message = msg.toString();
  const parts = message.split('|');

  if (parts.length !== 3) return; // Invalid message format

  const [peerName, timestamp, receivedHMAC] = parts;
  const payload = `${peerName}|${timestamp}`;
  const expectedHMAC = generateHMAC(payload);

  if (receivedHMAC !== expectedHMAC) {
    console.warn(`Invalid HMAC from ${rinfo.address}:${rinfo.port}`);
    return; // Ignore invalid messages
  }

  const peerAddress = `${rinfo.address}:${rinfo.port}`;
  if (!discoveredPeers.has(peerAddress)) {
    console.log(`Discovered new peer: ${peerName} from ${peerAddress}`);
  }

  // Update peer timestamp
  discoveredPeers.set(peerAddress, { peerName, lastSeen: Date.now() });
});

// Remove inactive peers
function cleanInactivePeers() {
  const now = Date.now();
  for (const [peerAddress, peerInfo] of discoveredPeers.entries()) {
    if (now - peerInfo.lastSeen > PEER_TIMEOUT) {
      console.log(`Removing inactive peer: ${peerInfo.peerName} (${peerAddress})`);
      discoveredPeers.delete(peerAddress);
    }
  }
}

// Set up the socket
socket.on('listening', () => {
  const address = socket.address();
  console.log(`Listening for messages on ${address.address}:${address.port}`);
  socket.addMembership(MULTICAST_ADDRESS); // Join multicast group
  socket.setBroadcast(true); // Enable broadcast (optional for multicast)
});

// Handle errors
socket.on('error', (err) => {
  console.error('Socket error:', err);
  socket.close();
});

// Start listening on the multicast port
socket.bind(MULTICAST_PORT, () => {
  console.log(`Socket bound to port ${MULTICAST_PORT}`);
});

// Start broadcasting presence at regular intervals
setInterval(broadcastPresence, BROADCAST_INTERVAL);

// Clean up inactive peers at regular intervals
setInterval(cleanInactivePeers, PEER_TIMEOUT / 2);
