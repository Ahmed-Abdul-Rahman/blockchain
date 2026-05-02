import { createLibp2p } from './libp2p.js';
import { AntiEntropyMessage, BaseMessage } from './types.js';
import { setupRPCStream } from './utils.js';

async function run() {
  // Create a new libp2p node on localhost with a randomly chosen port
  const dialer = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/0'],
    },
  });

  // Output this node's address
  console.log('Dialer ready, listening on:');
  dialer.getMultiaddrs().forEach((ma) => {
    console.log(ma.toString());
  });

  const handleStreamData = (message: BaseMessage<AntiEntropyMessage>): BaseMessage<AntiEntropyMessage> | null => {
    console.log('Received message: ', message);
    const { type } = message.payload;
    if (type === 'REQUEST_TOP_N')
      return { payload: { type: 'RESPONSE_TOP_N', snapshot: `${message.payload?.levels}-snapshot-dialer` } };

    if (type === 'REQUEST_BRANCHES')
      return { payload: { type: 'RESPONSE_BRANCHES', branches: `${message.payload?.prefixes}-branches-dialer` } };

    return null;
  };

  dialer.addEventListener('peer:discovery', (evt) => {
    console.info('peer:discovery', evt.detail);

    // Dial to the remote peer (the "listener")
    dialer.dialProtocol(evt.detail.multiaddrs, '/chat/1.0.0').then(async (stream) => {
      console.log('Dialed to listener. Chat is active.');
      const { sendRequest } = setupRPCStream<AntiEntropyMessage>(stream, handleStreamData);

      const response1 = await sendRequest({
        payload: { type: 'REQUEST_TOP_N', levels: 3 },
      } as BaseMessage<AntiEntropyMessage>);
      console.log('Got handler response 1! ', response1);

      const response2 = await sendRequest({
        payload: { type: 'REQUEST_BRANCHES', prefixes: 'abc-123' },
      } as BaseMessage<AntiEntropyMessage>);
      console.log('Got handler response 2! ', response2);
    });
  });
}

run();
