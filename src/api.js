import axios from 'axios';
import bitcoin from './blockchain.js';
import { getMiningRewardTransaction } from './utils.js';

export const getBlockChain = (req, res) => {
  res.send(bitcoin);
};

export const postTransaction = (req, res) => {
  const { newTransaction } = req.body;
  const blockNumber = bitcoin.addTransactionToPendingTransactions(newTransaction);
  res.json({ note: `Transaction will be added in block ${blockNumber}.` });
};

export const postTransactionBroadcast = (req, res) => {
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
};

export const getMineBlock = (nodeAddress, req, res) => {
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
};

export const postRecieveNewBlock = (req, res) => {
  const { newBlock } = req.body;
  if (bitcoin.isValidBlock(newBlock)) {
    bitcoin.addNewBlock(newBlock);
    res.json({ note: `New block received and accpeted.`, newBlock });
  } else {
    res.json({ note: `New block rejected.`, newBlock });
  }
};

export const postRegisterAndBroadcastNode = (req, res) => {
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
};

export const postRegisterNode = (req, res) => {
  const { newNodeUrl } = req.body;
  const isNodeAlreadyPresent = bitcoin.networkNodes.indexOf(newNodeUrl) !== -1;
  const isCurrentNode = bitcoin.currentNode === newNodeUrl;

  if (isNodeAlreadyPresent || isCurrentNode) return res.json({ note: `Node already registered.` });

  bitcoin.networkNodes.push(newNodeUrl);
  res.json({ note: `New node registered successfully with network.` });
};

export const postRegisterNodesBulk = (req, res) => {
  const { allNetworkNodes } = req.body;

  allNetworkNodes.forEach((networkNodeUrl) => {
    const isNodeAlreadyPresent = bitcoin.networkNodes.indexOf(networkNodeUrl) !== -1;
    const isCurrentNode = bitcoin.currentNode === networkNodeUrl;
    if (isNodeAlreadyPresent || isCurrentNode) return;
    bitcoin.networkNodes.push(networkNodeUrl);
  });

  res.json({ note: `Bulk nodes registration successfull.` });
};

export const getConsensus = (req, res) => {
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
};
