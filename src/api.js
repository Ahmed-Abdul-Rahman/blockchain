import axios from 'axios';
import bitcoin from './blockchain.js';
import { getMiningRewardTransaction } from './utils.js';
import { initiateChallenge, signMessage } from './cryptoUtils.js';

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
  bitcoin.networkNodes.forEach(({ nodeAddress }) => {
    const transactionRequest = {
      method: 'post',
      url: nodeAddress + '/transaction',
      data: { newTransaction },
    };
    transactionRequestPromises.push(axios(transactionRequest));
  });

  Promise.all(transactionRequestPromises).then(() => {
    res.json({ note: `New Transaction created & broadcasted successfully.` });
  });
};

export const getMineBlock = (req, res) => {
  const lastBlock = bitcoin.getLastBlock();
  const previousBlockHash = lastBlock['hash'];
  const currentBlockData = bitcoin.getPendingBlockData();

  const nonce = bitcoin.proofOfWork(previousBlockHash, currentBlockData);
  const blockHash = bitcoin.hashBlock(previousBlockHash, currentBlockData, nonce);
  const newBlock = bitcoin.createNewBlock(nonce, previousBlockHash, blockHash);

  const blocksPromises = [];
  bitcoin.networkNodes.forEach(({ nodeAddress }) => {
    const receiveBlockRequest = {
      method: 'post',
      url: nodeAddress + '/receive-new-block',
      data: { newBlock },
    };
    blocksPromises.push(axios(receiveBlockRequest));
  });

  Promise.all(blocksPromises)
    .then(() => {
      const broadcastTransactionRequest = {
        method: 'post',
        url: bitcoin.currentNode.nodeAddress + '/transaction/broadcast',
        data: { ...getMiningRewardTransaction(bitcoin.currentNode.nodeUUID) },
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

export const postRegisterAndBroadcastNode = async (publicKey, req, res) => {
  const { newNodeUrl } = req.body;
  const { isValid, publicKey: newNodePublicKey } = await initiateChallenge(newNodeUrl, publicKey);

  if (!isValid) return res.json({ note: `The Node is inValid, hence cannot be added to the network` });

  if (bitcoin.networkNodes.findIndex(({ nodeAddress }) => nodeAddress === newNodeUrl) === -1)
    bitcoin.networkNodes.push({ nodeAddress: newNodeUrl, publicKey: newNodePublicKey });

  const registerNodePromises = [];
  bitcoin.networkNodes.forEach(({ nodeAddress }) => {
    const registerNodeRequest = {
      method: 'post',
      url: nodeAddress + '/register-node',
      data: { newNodeUrl, publicKey: newNodePublicKey },
    };
    registerNodePromises.push(axios(registerNodeRequest));
  });

  Promise.all(registerNodePromises)
    .then(() => {
      const bulkRegisterRequest = {
        method: 'post',
        url: newNodeUrl + '/register-nodes-bulk',
        data: { allNetworkNodes: [...bitcoin.networkNodes, bitcoin.getCurrentNode()] },
      };
      return axios(bulkRegisterRequest);
    })
    .then(() => {
      res.json({ note: 'New node registered with network successfully.' });
    });
};

export const postRegisterNode = (req, res) => {
  const { newNodeUrl, publicKey } = req.body;
  const isNodeAlreadyPresent = bitcoin.networkNodes.findIndex(({ nodeAddress }) => nodeAddress === newNodeUrl) !== -1;
  const isCurrentNode = bitcoin.currentNode.nodeAddress === newNodeUrl;

  if (isNodeAlreadyPresent || isCurrentNode) return res.json({ note: `Node already registered.` });

  bitcoin.networkNodes.push({ nodeAddress: newNodeUrl, publicKey });
  res.json({ note: `New node registered successfully with network.` });
};

export const postRegisterNodesBulk = (req, res) => {
  const { allNetworkNodes } = req.body;

  allNetworkNodes.forEach(({ nodeAddress, publicKey }) => {
    const isNodeAlreadyPresent =
      bitcoin.networkNodes.findIndex(({ nodeAddress: address }) => address === nodeAddress) !== -1;
    const isCurrentNode = bitcoin.currentNode.nodeAddress === nodeAddress;
    if (isNodeAlreadyPresent || isCurrentNode) return;
    bitcoin.networkNodes.push({ nodeAddress, publicKey });
  });

  res.json({ note: `Bulk nodes registration successfull.` });
};

export const getConsensus = (req, res) => {
  const requestPromises = [];
  bitcoin.networkNodes.forEach(({ nodeAddress }) => {
    const request = {
      method: 'get',
      url: nodeAddress + '/blockchain',
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

export const postChallenge = (privateKey, req, res) => {
  const { challenge, publicKey: nodePublickey } = req.body;
  if (!challenge || !nodePublickey) return res.status(400).json({ error: 'Invalid challenge request' });
  const response = signMessage(challenge, privateKey); // Sign the challenge with the private key
  res.status(200).json({ response, publicKey: bitcoin.getCurrentNodePublicKey() });
};
