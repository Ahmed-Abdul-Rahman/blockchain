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
} from './api.js';
import { signMessage } from './cryptoUtils.js';
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
import DHT from 'bittorrent-dht';
import { initiateChallenge, startDHT } from './dhtNode.js';
import crypto from 'crypto';

const port = process.argv[2];

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const app = express();
const dht = new DHT();

const nodeAddress = uuidV1().split('-').join('');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

//get entire blockchain
app.get(BLOCKCHAIN, getBlockChain);

//create a new transaction
app.post(TRANSACTION, postTransaction);

app.post(TRANSACTION_BROADCAST, postTransactionBroadcast);

//mine a block
app.get(MINE, getMineBlock.bind(null, nodeAddress));

app.post(RECEIVE_NEW_BLOCK, postRecieveNewBlock);

//register a node and broadcast it to the network
app.post(REGISTER_AND_BROADCAST_NODE, postRegisterAndBroadcastNode);

//register a node with network
app.post(REGISTER_NODE, postRegisterNode);

//register multiple nodes at once
app.post(REGISTER_NODES_BULK, postRegisterNodesBulk);

app.get(CONSENSUS, getConsensus);

app.post(CHALLENGE, (req, res) => {
  const { challenge, publicKey: nodePublickey } = req.body;
  console.log(`Challenge Initiated with ${challenge} ${nodePublickey}`);
  if (!challenge || !nodePublickey) return res.status(400).json({ error: 'Invalid challenge request' });
  const response = signMessage(challenge, privateKey); // Sign the challenge with the private key
  res.status(200).json({ response, publicKey });
});

app.post('/initiate-challenge', async (req, res) => {
  const { newNodeAddr } = req.body;
  const isValid = await initiateChallenge(newNodeAddr, publicKey);
  res.json({ note: `The Node Address is ${isValid ? 'valid' : 'not valid'}.` });
});

app.listen(port, () => {
  console.log(`Listening on Port ${port}...`);
});

// startDHT(dht, port, 'decentralized-node-discovery', publicKey, initiateChallenge);
