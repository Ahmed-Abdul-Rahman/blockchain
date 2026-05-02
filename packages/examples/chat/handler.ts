import { createLibp2p } from './libp2p.js';
import { AntiEntropyMessage, BaseMessage } from './types.js';
import { setupRPCStream } from './utils.js';

async function run() {
  // Create a new libp2p node with the given multi-address
  const listener = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/10333'],
    },
  });

  // Log a message when a remote peer connects to us
  listener.addEventListener('peer:connect', (evt) => {
    const remotePeer = evt.detail;
    console.log('connected to: ', remotePeer.toString());
  });

  const handleStreamData = (message: BaseMessage<AntiEntropyMessage>): BaseMessage<AntiEntropyMessage> | null => {
    console.log('Received message: ', message);

    const { type } = message.payload;
    if (type === 'REQUEST_TOP_N') {
      return { payload: { type: 'RESPONSE_TOP_N', snapshot: `${message.payload?.levels}-snapshot-handler` } };
    }
    if (type === 'REQUEST_BRANCHES') {
      return { payload: { type: 'RESPONSE_BRANCHES', branches: `${message.payload?.prefixes}-branches-handler` } };
    }
    return null;
  };

  // Handle messages for the protocol
  await listener.handle('/chat/1.0.0', async ({ stream }) => {
    console.log('Incoming chat stream opened!');
    const { sendRequest } = setupRPCStream<AntiEntropyMessage>(stream, handleStreamData);

    const response1 = await sendRequest({
      payload: { type: 'REQUEST_TOP_N', levels: 5 },
    } as BaseMessage<AntiEntropyMessage>);
    console.log('Got Dialer response 1! ', response1);

    const response2 = await sendRequest({
      payload: { type: 'REQUEST_BRANCHES', prefixes: 'xyz-321' },
    } as BaseMessage<AntiEntropyMessage>);
    console.log('Got Dialer response 2! ', response2);
  });

  // Output listen addresses to the console
  console.log('Handler ready, listening on:');
  listener.getMultiaddrs().forEach((ma) => {
    console.log(ma.toString());
  });
}

run();
