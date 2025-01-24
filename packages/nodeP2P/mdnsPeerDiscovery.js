import { createNode } from './mdns.js'; // Assuming the previous code is in libp2pSetup.js

const PROTOCOL = '/chat/1.0.0';

const main = async () => {
  const node = await createNode();

  // Start the libp2p node
  await node.start();
  console.log('libp2p has started');

  // Set up a handler for incoming messages on the specified protocol
  node.handle(PROTOCOL, async ({ stream }) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream.source) {
      console.log('Received message:', decoder.decode(chunk));
    }
  });

  // Function to send a message to a specific peer
  const sendMessage = async (peerId, message) => {
    try {
      const { stream } = await node.dialProtocol(peerId, PROTOCOL);
      const encoder = new TextEncoder();
      await stream.sink([encoder.encode(message)]);
      console.log(`Sent message to ${peerId.toString()}: ${message}`);
    } catch (err) {
      console.error(`Could not send message to ${peerId.toString()}:`, err);
    }
  };

  // Example usage: send a message to all discovered peers every 5 seconds
  setInterval(async () => {
    const peers = node.getPeers();
    for (const peer of peers) {
      await sendMessage(peer.id, 'Hello, peer!');
    }
  }, 5000);
};

main().catch((err) => {
  console.error('An error occurred:', err);
});
