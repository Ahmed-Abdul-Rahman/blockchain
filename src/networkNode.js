import express from 'express';
import bodyParser from 'body-parser';
import { v1 as uuidV1 } from 'uuid';
import axios from 'axios';
import { BlockChain } from './blockchain.js';
import { getMiningRewardTransaction } from './utils.js';

const port = process.argv[2];

const app = express();

const nodeAddress = uuidV1().split('-').join('');

const bitcoin = new BlockChain();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

//get entire blockchain
app.get('/blockchain', (req, res) => {
  res.send(bitcoin);
});

//create a new transaction
app.post('/transaction', (req, res) => {
  const { newTransaction } = req.body;
  const blockNumber = bitcoin.addTransactionToPendingTransactions(newTransaction);
  res.json({ note: `Transaction will be added in block ${blockNumber}.` });
});

app.post('/transaction/broadcast', (req, res) => {
  const { amount, data, senderAddress, recipientAddress } = req.body;
  const newTransaction = bitcoin.createNewTransaction(amount, data, senderAddress, recipientAddress);
  bitcoin.addTransactionToPendingTransactions(newTransaction);

  const transactionRequestPromises = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const transactionRequest = {
      method: 'post',
      url: networkNodeUrl + '/transaction',
      data: { newTransaction },
    };
    transactionRequestPromises.push(axios(transactionRequest));
  });

  Promise.all(transactionRequestPromises).then(() => {
    res.json({ note: `New Transaction created & broadcasted successfully.` });
  });
});

//mine a block
app.get('/mine', (req, res) => {
  const lastBlock = bitcoin.getLastBlock();
  const previousBlockHash = lastBlock['hash'];
  const currentBlockData = bitcoin.getPendingBlockData();

  const nonce = bitcoin.proofOfWork(previousBlockHash, currentBlockData);
  const blockHash = bitcoin.hashBlock(previousBlockHash, currentBlockData, nonce);
  const newBlock = bitcoin.createNewBlock(nonce, previousBlockHash, blockHash);

  const blocksPromises = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const receiveBlockRequest = {
      method: 'post',
      url: networkNodeUrl + '/receive-new-block',
      data: { newBlock },
    };
    blocksPromises.push(axios(receiveBlockRequest));
  });

  Promise.all(blocksPromises)
    .then(() => {
      const broadcastTransactionRequest = {
        method: 'post',
        url: bitcoin.currentNode + '/transaction/broadcast',
        data: { ...getMiningRewardTransaction(nodeAddress) },
      };
      return axios(broadcastTransactionRequest);
    })
    .then(() => {
      res.json({ note: `New block mined & broadcasted successfully.`, block: newBlock });
    });
});

app.post('/receive-new-block', (req, res) => {
  const { newBlock } = req.body;
  if (bitcoin.isValidBlock(newBlock)) {
    bitcoin.addNewBlock(newBlock);
    res.json({ note: `New block received and accpeted.`, newBlock });
  } else {
    res.json({ note: `New block rejected.`, newBlock });
  }
});

//register a node and broadcast it to the network
app.post('/register-and-broadcast-node', (req, res) => {
  const { newNodeUrl } = req.body;
  if (bitcoin.networkNodes.indexOf(newNodeUrl) === -1) bitcoin.networkNodes.push(newNodeUrl);

  const registerNodePromises = [];
  bitcoin.networkNodes.forEach((networkNode) => {
    const registerNodeRequest = {
      method: 'post',
      url: networkNode + '/register-node',
      data: { newNodeUrl },
    };
    registerNodePromises.push(axios(registerNodeRequest));
  });

  Promise.all(registerNodePromises)
    .then(() => {
      const bulkRegisterRequest = {
        method: 'post',
        url: newNodeUrl + '/register-nodes-bulk',
        data: { allNetworkNodes: [...bitcoin.networkNodes, bitcoin.currentNode] },
      };
      return axios(bulkRegisterRequest);
    })
    .then(() => {
      res.json({ note: 'New node registered with network successfully.' });
    });
});

//register a node with network
app.post('/register-node', (req, res) => {
  const { newNodeUrl } = req.body;
  const isNodeAlreadyPresent = bitcoin.networkNodes.indexOf(newNodeUrl) !== -1;
  const isCurrentNode = bitcoin.currentNode === newNodeUrl;

  if (isNodeAlreadyPresent || isCurrentNode) return res.json({ note: `Node already registered.` });

  bitcoin.networkNodes.push(newNodeUrl);
  res.json({ note: `New node registered successfully with network.` });
});

//register multiple nodes at once
app.post('/register-nodes-bulk', (req, res) => {
  const { allNetworkNodes } = req.body;

  allNetworkNodes.forEach((networkNodeUrl) => {
    const isNodeAlreadyPresent = bitcoin.networkNodes.indexOf(networkNodeUrl) !== -1;
    const isCurrentNode = bitcoin.currentNode === networkNodeUrl;
    if (isNodeAlreadyPresent || isCurrentNode) return;
    bitcoin.networkNodes.push(networkNodeUrl);
  });

  res.json({ note: `Bulk nodes registration successfull.` });
});

app.get('/consensus', (req, res) => {
  const requestPromises = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const request = {
      method: 'get',
      url: networkNodeUrl + '/blockchain',
    };
    requestPromises.push(axios(request));
  });

  Promise.all(requestPromises).then((blockchainsData) => {
    const currentChainLength = bitcoin.chain.length;
    let maxChainLength = currentChainLength;
    let newLongestChain = null;
    let newPendingTransactions = null;
    blockchainsData.forEach(({ data: blockchain }) => {
      if (blockchain.chain.length > maxChainLength) {
        maxChainLength = blockchain.chain.length;
        newLongestChain = blockchain.chain;
        newPendingTransactions = blockchain.pendingTransactions;
      }
    });
    if (!newLongestChain || (newLongestChain && !bitcoin.isChainValid(newLongestChain))) {
      res.json({ note: `Current chain has not been replaced.`, chain: bitcoin.chain });
    } else {
      bitcoin.updateChain({ chain: newLongestChain, pendingTransactions: newPendingTransactions });
      res.json({ note: `This chain has been replaced.`, chain: bitcoin.chain });
    }
  });
});

app.listen(port, () => {
  console.log(`Listening on Port ${port}...`);
});
