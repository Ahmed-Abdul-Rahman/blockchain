import express from 'express';
import bodyParser from 'body-parser';
import {
  getBlockChain,
  getConsensus,
  getMineBlock,
  postTransactionBroadcast,
  postRecieveNewBlock,
  postRegisterAndBroadcastNode,
  postRegisterNode,
  postRegisterNodesBulk,
  postTransaction,
  postChallenge,
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
import crypto from 'crypto';
import bitcoin from '../packages/blockchain/blockchain.js';
import rateLimit from 'express-rate-limit';
import { createNode, dialNode, recieveNodeMessages, registerNodeDiscovery } from '../packages/nodeP2P/mdns.js';
import { getMessageToDial, isValidInfoHash } from './helper.js';
// import { ESTABLISH_CONNECTION } from './constants.js';
// import { initiateChallenge } from './cryptoUtils.js';
// import sha256 from 'sha256';

// let isPartOfNetwork = true;
// const genesisTimestamp = Date.now();
// const networkId = sha256(genesisTimestamp);

const port = process.argv[2];
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
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

const handleNodeMessage = (data) => {
  console.log('In handleNodeMessage ', data);
  const { nodeId, infoHash } = data;
  if (!isValidInfoHash(infoHash)) {
    console.log('In valid node cannot process further instructions', nodeId);
    return;
  }
  // if (instruction === ESTABLISH_CONNECTION) {
  //   initiateChallenge()
  // }
};

app.listen(port, async () => {
  const node = await createNode();

  registerNodeDiscovery(node, dialNode, getMessageToDial(node));
  recieveNodeMessages(node, handleNodeMessage);

  await node.start();
  bitcoin.setCurrentNode(process.argv[3], node.peerId.toString(), publicKey);
  console.log(`Node - ${node.peerId.toString()} - Listening on Port ${port}...`);
});
