import bytecoin from '@blockchain/Blockchain';
import { sha256 } from '@common/utils.js';
import createNetworkNode from '@nodeP2P/index.js';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import { EventId } from 'eventid';
import express from 'express';
import rateLimit from 'express-rate-limit';
import http2 from 'http2';
import { AddressInfo } from 'net';

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
import { infoHash } from './constants.js';

const nodeEventId = new EventId();

const networkNodeConfig = {
  nodeConfig: {
    nodeEventId: nodeEventId.new(),
    get networkId() {
      return sha256(this.nodeEventId);
    },
    infoHash: infoHash,
    genesisTimestamp: Date.now(),
  },
  protocol: '/hanshake/1.0.0',
};

// const port = process.argv[2];
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const app = express();
const server = http2.createServer(app);
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

server.listen(0, async () => {
  const { address, port } = server.address() as AddressInfo;
  const networkNode = await createNetworkNode(networkNodeConfig);
  bytecoin.setCurrentNode(`http://${address}:${port}`, networkNode.nodeId?.toString(), publicKey);
  process.env.SERVER_PORT = `${port}`;
  console.log(`Node - ${networkNode.nodeId} - Listening on Port ${port}...`);
});
