import express from 'express';
import bodyParser from 'body-parser';
import { v1 as uuidV1 } from 'uuid';
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
} from './constants.js';
import crypto from 'crypto';
import bitcoin from '../packages/blockchain/blockchain.js';
import rateLimit from 'express-rate-limit';

const port = process.argv[2];
const nodeUUID = uuidV1().split('-').join('');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const app = express();
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per minute
  message: { note: 'Too many requests, please try again later.' },
});

bitcoin.setCurrentNode(process.argv[3], nodeUUID, publicKey);

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

app.listen(port, () => {
  console.log(`Node ${nodeUUID} Listening on Port ${port}...`);
});

// startDHT(dht, port, 'decentralized-node-discovery', publicKey, initiateChallenge);
