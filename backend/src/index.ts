import bytecoin from '@blockchain/Blockchain';
import { sha256 } from '@common/crypto';
import { NetworkNode } from '@nodeP2P/NetworkNode';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';

import {
  getBlockChain,
  getConsensus,
  getMineBlock,
  postChallenge,
  postRecieveNewBlock,
  postRegisterAndBroadcastNode,
  postRegisterNode,
  postRegisterNodesBulk,
  postTransaction,
  postTransactionBroadcast,
} from './api.js';
import {
  BLOCKCHAIN,
  CHALLENGE,
  CONSENSUS,
  MINE,
  RECEIVE_NEW_BLOCK,
  REGISTER_AND_BROADCAST_NODE,
  REGISTER_NODE,
  REGISTER_NODES_BULK,
  TRANSACTION,
  TRANSACTION_BROADCAST,
} from './apiPaths.js';
import { getMessageToDial, handleNodeMessage } from './helper.js';

const networkNodeConfig = {
  genesisTimestamp: Date.now(),
  get networkId() {
    return sha256(this.genesisTimestamp.toString());
  },
  protocol: '/hanshake/1.0.0',
};

const port = process.argv[2];
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const app = express();
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per minute
  message: { note: 'Too many requests, please try again later.' },
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(limiter);

//get entire blockchain
app.get(BLOCKCHAIN, getBlockChain);

//create a new transaction
app.post(TRANSACTION, postTransaction);

app.post(TRANSACTION_BROADCAST, postTransactionBroadcast);

//mine a block
app.get(MINE, getMineBlock);

app.post(RECEIVE_NEW_BLOCK, postRecieveNewBlock);

//register a node and broadcast it to the network
app.post(REGISTER_AND_BROADCAST_NODE, postRegisterAndBroadcastNode.bind(null, publicKey));

//register a node with network
app.post(REGISTER_NODE, postRegisterNode);

//register multiple nodes at once
app.post(REGISTER_NODES_BULK, postRegisterNodesBulk);

app.get(CONSENSUS, getConsensus);

app.post(CHALLENGE, postChallenge.bind(null, privateKey));

app.listen(port, async () => {
  const networkNode = new NetworkNode(networkNodeConfig);
  await networkNode.init();

  networkNode.registerNodeDiscovery(getMessageToDial(), null);
  networkNode.receiveNodeMessages(handleNodeMessage);

  await networkNode.start();
  bytecoin.setCurrentNode(process.argv[3], networkNode.nodeId, publicKey);
  console.log(`Node - ${networkNode.nodeId} - Listening on Port ${port}...`);
});
