const discoveredPeers = new Map();

export const addPeer = (peerAddress, peerName) => {
  discoveredPeers.set(peerAddress, { peerName, lastSeen: Date.now() });
};

export const updatePeerTimestamp = (peerAddress) => {
  if (discoveredPeers.has(peerAddress)) {
    discoveredPeers.get(peerAddress).lastSeen = Date.now();
  }
};

export const cleanInactivePeers = (peerTimeout) => {
  const now = Date.now();
  for (const [peerAddress, peerInfo] of discoveredPeers.entries()) {
    if (now - peerInfo.lastSeen > peerTimeout) {
      console.log(`Removing inactive peer: ${peerInfo.peerName} (${peerAddress})`);
      discoveredPeers.delete(peerAddress);
    }
  }
};

export const getPeers = () => Array.from(discoveredPeers.entries());
