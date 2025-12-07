import { GossipSub, gossipsub } from '@chainsafe/libp2p-gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { pickRandom, wait } from '@dechat/common';
import { generateIdProtocolPrefix, sha256 } from '@dechat/crypto';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { identify } from '@libp2p/identify';
import { Message, PeerInfo } from '@libp2p/interface';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { createLibp2p, Libp2p } from 'libp2p';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { genEd25519KeyPair } from './auth';

const TOPIC = 'topic-testing';

export const parseArg = <T = string | number | boolean | undefined>(name: string, defaultValue?: T): T => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 && defaultValue) return defaultValue;
  if (index === -1) return undefined as T;
  const rawValue = process.argv[index + 1];
  if (rawValue === undefined) return true as T;
  return (/^\d+$/.test(rawValue) ? Number(rawValue) : rawValue) as T;
};

const createNode = async (nodeSeed?: string): Promise<Libp2p> => {
  const nodeKey = await genEd25519KeyPair(nodeSeed);
  const privateKey = await generateKeyPairFromSeed('Ed25519', nodeKey.secret);
  const listenAddrs = ['/ip4/0.0.0.0/tcp/0'];
  const transports = [tcp()];
  const streamMuxers = [yamux()];
  const connectionEncrypters = [noise()];

  const node = (await createLibp2p({
    privateKey,
    addresses: { listen: listenAddrs },
    transports,
    connectionEncrypters,
    streamMuxers,
    peerDiscovery: [mdns({ interval: 10e3 })],
    services: {
      identify: identify({
        protocolPrefix: generateIdProtocolPrefix(sha256('infoHash')),
        agentVersion: 'Node-1.0.0',
      }),
      pubsub: gossipsub({
        // tune as desired; keep scoring ON in gossipsub if you enable it later
        emitSelf: false,
        allowPublishToZeroTopicPeers: false,
      }),
    },
  })) as Libp2p;

  return node;
};

const initiatePubSub = async (node: Libp2p) => {
  const pubsub = node.services.pubsub as GossipSub;
  const shouldPublish = true;

  pubsub.addEventListener('message', (event: CustomEvent<Message>) => {
    const detail = event.detail;
    const data = detail.data;
    if (!data || event.detail.topic !== TOPIC) return;

    const { from, details } = JSON.parse(uint8ArrayToString(data));

    console.log('Received message from: ', from, ' detail: ', details);
  });

  pubsub.subscribe(TOPIC);
  await wait(5_000);

  while (shouldPublish) {
    try {
      // console.log('mesh: ', pubsub.mesh);
      // console.log('------');
      // console.log('gossip: ', pubsub.gossip);
      // console.log('------');
      // console.log('subscribers: ', pubsub.getSubscribers(TOPIC));

      await wait(10_000);
      await pubsub.publish(
        TOPIC,
        uint8ArrayFromString(JSON.stringify({ from: node.peerId.toString(), details: 'Hello' })),
      );
      console.log('Published message on topic ', TOPIC);
    } catch (error: unknown) {
      const msg = (error as Error).message;
      if (msg.includes('PublishError.NoPeersSubscribedToTopic') || msg.includes('NoPeersSubscribedToTopic')) {
        console.log('Error occured PublishError.NoPeersSubscribedToTopic');
      } else console.log('Error occured while publishing a gossip message to a peer');
    }
  }
};

const runNode = async (seed?: string) => {
  const node = await createNode(seed);
  console.log('Node started: ', node.peerId);

  let isPubsubInitiated = false;

  node.addEventListener('peer:discovery', async (event: CustomEvent<PeerInfo>) => {
    const peerId = event.detail.id.toString();
    console.log('Peer Discovered: ', peerId);
    try {
      const connection = await node.dial(event.detail.id);
      console.log('Outbound just dial connection: ', connection);
      console.log('Connected to peer:', peerId);
    } catch (err) {
      console.error('Dial failed:', err);
    }
  });

  if (!isPubsubInitiated) {
    initiatePubSub(node);
    isPubsubInitiated = true;
  }

  node.handle('DIAL', async ({ connection }) => {
    console.log('Incoming connection on DIAL', connection);
  });

  await wait(20_000);

  const chance = Math.random() <= 0.5;

  if (chance) {
    const allPeers = await node.peerStore.all();
    const { item: randomPeer } = pickRandom(allPeers);
    console.log('Dialing peer: ', randomPeer.id);
    try {
      await node.dialProtocol(randomPeer.id, 'DIAL');
    } catch (error) {
      console.error('DIAL protocol failed:', error);
    }
  }

  await wait(2000);
  console.log(node.getConnections());
};

const seed = parseArg('seed') as string;
runNode(seed);
