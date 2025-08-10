import http2 from 'http2';
import { AddressInfo } from 'net';
import path from 'path';
import bodyParser from 'body-parser';
import { EventId } from 'eventid';
import express from 'express';
import rateLimit from 'express-rate-limit';
import bytecoin from '@blockchain/Blockchain';
import { sha256 } from '@common/utils.js';
import { loadOrGenerateKeypair } from '@crypto/utils.js';
import createNetworkNode from '@nodeP2P/index.js';

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

const KEY_FILE = path.join(process.cwd(), 'node_identity.pem');

const nodeEventId = new EventId();
const { publicKey, privateKey } = loadOrGenerateKeypair(KEY_FILE, true);

process.env.NODE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
process.env.NODE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const networkNodeConfig = {
  nodeConfig: {
    nodeEventId: nodeEventId.new(),
    nodePrivateKey: privateKey,
    nodePublicKey: publicKey,
    get networkId() {
      return sha256(this.nodeEventId);
    },
    infoHash: infoHash,
    genesisTimestamp: Date.now(),
  },
  protocol: '/hanshake/1.0.0',
};

// const port = process.argv[2];

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

const postChallengeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes.',
});

app.post(CHALLENGE, postChallengeRateLimiter, postChallenge.bind(null, privateKey));

server.listen(0, async () => {
  const { address, port } = server.address() as AddressInfo;
  const networkNode = await createNetworkNode(networkNodeConfig);
  await networkNode.start();
  bytecoin.setCurrentNode(`http://${address}:${port}`, networkNode.nodeId?.toString(), publicKey);
  process.env.SERVER_PORT = `${port}`;
  console.log(`Node - ${networkNode.nodeId} - Listening on Port ${port}...`);
});
