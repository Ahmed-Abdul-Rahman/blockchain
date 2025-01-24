import dgram from 'dgram';
import { encryptMessage, decryptMessage, generateHMAC } from './security.js';
import { addPeer, updatePeerTimestamp, cleanInactivePeers } from './peerManager.js';
import {
  MULTICAST_ADDRESS,
  MULTICAST_PORT,
  BROADCAST_INTERVAL,
  AES_KEY,
  SECRET_KEY,
  PEER_NAME,
  INFO_HASH,
  PEER_TIMEOUT,
} from './config.js';

export const startDiscovery = () => {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  // Broadcast presence
  const broadcastPresence = () => {
    const payload = JSON.stringify({
      peerName: PEER_NAME,
      timestamp: Date.now(),
      infoHash: INFO_HASH, // Include the infoHash in the payload
    });

    const encryptedPayload = encryptMessage(payload, AES_KEY);
    const hmac = generateHMAC(encryptedPayload, SECRET_KEY);
    const message = Buffer.from(`${encryptedPayload}|${hmac}`);
    socket.send(message, 0, message.length, MULTICAST_PORT, MULTICAST_ADDRESS);
  };

  // Handle incoming messages
  socket.on('message', (msg, rinfo) => {
    const [encryptedPayload, receivedHMAC] = msg.toString().split('|', 2);

    // Validate HMAC
    const expectedHMAC = generateHMAC(encryptedPayload, SECRET_KEY);
    if (receivedHMAC !== expectedHMAC) {
      // console.warn(`Invalid HMAC from ${rinfo.address}:${rinfo.port}`);
      return;
    }

    // Decrypt payload
    let payload;
    try {
      payload = JSON.parse(decryptMessage(encryptedPayload, AES_KEY));
    } catch (err) {
      console.error(`Failed to decrypt message from ${rinfo.address}:${rinfo.port} ${err}`);
      return;
    }

    const { peerName, infoHash } = payload;

    // Filter peers by infoHash
    if (infoHash !== INFO_HASH) {
      // console.log(`Ignoring peer with mismatched infoHash from ${rinfo.address}:${rinfo.port}`);
      return;
    }

    const peerAddress = `${rinfo.address}:${rinfo.port}`;
    addPeer(peerAddress, peerName);
    updatePeerTimestamp(peerAddress);
  });

  // Clean inactive peers periodically
  setInterval(() => cleanInactivePeers(PEER_TIMEOUT), BROADCAST_INTERVAL);

  // Start the socket
  socket.on('listening', () => {
    socket.addMembership(MULTICAST_ADDRESS);
    console.log(`Discovery started on ${MULTICAST_PORT}`);
  });

  socket.bind(MULTICAST_PORT);
  setInterval(broadcastPresence, BROADCAST_INTERVAL);
};
