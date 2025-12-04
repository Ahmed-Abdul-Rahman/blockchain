import { setTimeout as delay } from 'node:timers/promises';
import { parentPort, threadId, workerData } from 'node:worker_threads';
import { GossipSub } from '@chainsafe/libp2p-gossipsub/dist/src';
import { createNode } from '../../src/node';
import { WorkerData } from './types';

const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return -1;
  const i = Math.floor((p / 100) * (xs.length - 1));
  return xs[i];
};

const runNode = async () => {
  const args = workerData as WorkerData;
  const { index, nodeSeed, networkId, pubsubTopic, runDurationSec, messageRate } = args;

  // Start your node factory with mdns disabled for determinism (optional)
  const { node, pexService } = await createNode(networkId, nodeSeed, {
    mdns: true,
    listenTcp: ['/ip4/127.0.0.1/tcp/0'],
    // bootstrap: bootstrapMultiaddrs, // make your node.ts honor this
    onBoardingPeerTime: Math.random() * 10 * 1000,
  });

  await node.start();

  const me = node.peerId.toString();
  console.log('Wroker thread: ', threadId, 'and index: ', index, ' started with peerId: ', me);
  // Join pubsub topic
  const pubsub = node.services.pubsub as GossipSub;
  pubsub.subscribe(pubsubTopic);

  // Publish one "hello" when we first get peers
  const t0 = Date.now();
  let ttfvp: number | null = null;

  const checkVerified = () => {
    const size = pexService.peerRegistry.getSize();
    if (ttfvp === null && size > 0) ttfvp = Date.now() - t0;
  };
  const checkTimer = setInterval(checkVerified, 200);

  // Latency tracking
  const latencies: number[] = [];
  const subHandler = (evt) => {
    try {
      const msg = JSON.parse(new TextDecoder().decode(evt.detail.data));
      if (msg.type === 'ping') {
        const oneWay = Date.now() - msg.ts;
        latencies.push(oneWay);
      }
    } catch {}
  };

  pubsub.addEventListener('message', subHandler);

  // Send load
  const sendLoop = (async () => {
    const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, messageRate)));
    const enc = new TextEncoder();
    const deadline = Date.now() + runDurationSec * 1000;
    while (Date.now() < deadline) {
      await delay(intervalMs);
      const payload = enc.encode(JSON.stringify({ type: 'ping', ts: Date.now(), from: me }));
      try {
        await pubsub.publish(pubsubTopic, payload);
      } catch {}
    }
  })();

  await sendLoop;

  //Clean Up
  clearInterval(checkTimer);
  pubsub.removeEventListener('message', subHandler);

  // produce stats
  const stats = {
    me,
    verified: pexService.peerRegistry.getSize(),
    connections: node.getConnections().length,
    ttfvpMs: ttfvp ?? -1,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    msgsObserved: latencies.length,
  };

  parentPort?.postMessage({ type: 'done', stats });

  // graceful shutdown
  await node.stop();
  process.exit(0);
};

runNode().catch((e) => {
  console.log(`Caught worker ${threadId} error with threadId: `, e);
  parentPort?.postMessage({ type: 'error', error: String(e) });
  process.exit(1);
});
