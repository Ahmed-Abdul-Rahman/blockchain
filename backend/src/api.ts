import bytecoin from '@blockchain/Blockchain';
import axios, { AxiosResponse } from 'axios';
import crypto, { KeyObject } from 'crypto';
import { Request, Response } from 'express';

import { initiateChallenge, signMessage } from './cryptoUtils.js';

export const getBlockChain = (req: Request, res: Response): void => {
  res.send(bytecoin);
};

export const postTransaction = (req: Request, res: Response): void => {
  const { newTransaction } = req.body;
  const blockNumber = bytecoin.addTransactionToPendingTransactions(newTransaction);
  res.json({ note: `Transaction will be added in block ${blockNumber}.` });
};

export const postTransactionBroadcast = (req: Request, res: Response): void => {
  const { amount, data, senderAddress, recipientAddress } = req.body;
  const newTransaction = bytecoin.createNewTransaction(amount, data, senderAddress, recipientAddress);
  bytecoin.addTransactionToPendingTransactions(newTransaction);

  const transactionRequestPromises: Promise<AxiosResponse>[] = [];
  bytecoin.networkNodes.forEach(({ nodeAddress }) => {
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

export const getMineBlock = (req: Request, res: Response): void => {
  const lastBlock = bytecoin.getLastBlock();
  const previousBlockHash = lastBlock['hash'];
  const currentBlockData = bytecoin.getPendingBlockData();

  const nonce = bytecoin.proofOfWork(previousBlockHash, currentBlockData);
  const blockHash = bytecoin.hashBlock(previousBlockHash, currentBlockData, nonce);
  const newBlock = bytecoin.createNewBlock(nonce, previousBlockHash, blockHash);

  const blocksPromises: Promise<AxiosResponse>[] = [];
  bytecoin.networkNodes.forEach(({ nodeAddress }) => {
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
        url: bytecoin.currentNode.nodeAddress + '/transaction/broadcast',
        data: { ...bytecoin.getMiningRewardTransaction() },
      };
      return axios(broadcastTransactionRequest);
    })
    .then(() => {
      res.json({
        note: `New block mined & broadcasted successfully.`,
        block: newBlock,
      });
    });
};

export const postRecieveNewBlock = (req: Request, res: Response): void => {
  const { newBlock } = req.body;
  if (bytecoin.isValidBlock(newBlock)) {
    bytecoin.addNewBlock(newBlock);
    res.json({ note: `New block received and accpeted.`, newBlock });
  } else {
    res.json({ note: `New block rejected.`, newBlock });
  }
};

export const postRegisterAndBroadcastNode = async (
  publicKey: KeyObject,
  req: Request,
  res: Response,
): Promise<void> => {
  const { newNodeUrl, nodeUUID } = req.body;
  const { isValid, publicKey: newNodePublicKey } = await initiateChallenge(newNodeUrl, publicKey);

  if (!isValid) {
    res.json({
      note: `The Node is inValid, hence cannot be added to the network`,
    });
    return;
  }
  if (bytecoin.networkNodes.findIndex(({ nodeAddress }) => nodeAddress === newNodeUrl) === -1)
    bytecoin.networkNodes.push({
      nodeAddress: newNodeUrl,
      nodeUUID,
      publicKey: crypto.createPublicKey(newNodePublicKey),
    });

  const registerNodePromises: Promise<AxiosResponse>[] = [];
  bytecoin.networkNodes.forEach(({ nodeAddress }) => {
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
        data: {
          allNetworkNodes: [...bytecoin.networkNodes, bytecoin.getCurrentNode()],
        },
      };
      return axios(bulkRegisterRequest);
    })
    .then(() => {
      res.json({ note: 'New node registered with network successfully.' });
    });
};

export const postRegisterNode = (req: Request, res: Response): void => {
  const { newNodeUrl, nodeUUID, publicKey } = req.body;
  const isNodeAlreadyPresent = bytecoin.networkNodes.findIndex(({ nodeAddress }) => nodeAddress === newNodeUrl) !== -1;
  const isCurrentNode = bytecoin.currentNode.nodeAddress === newNodeUrl;

  if (isNodeAlreadyPresent || isCurrentNode) {
    res.json({ note: `Node already registered.` });
    return;
  }

  bytecoin.networkNodes.push({ nodeAddress: newNodeUrl, nodeUUID, publicKey });
  res.json({ note: `New node registered successfully with network.` });
};

export const postRegisterNodesBulk = (req: Request, res: Response): void => {
  const { allNetworkNodes } = req.body;

  allNetworkNodes.forEach(({ nodeAddress, nodeUUID, publicKey }) => {
    const isNodeAlreadyPresent =
      bytecoin.networkNodes.findIndex(({ nodeAddress: address }) => address === nodeAddress) !== -1;
    const isCurrentNode = bytecoin.currentNode.nodeAddress === nodeAddress;
    if (isNodeAlreadyPresent || isCurrentNode) return;
    bytecoin.networkNodes.push({ nodeAddress, nodeUUID, publicKey });
  });

  res.json({ note: `Bulk nodes registration successfull.` });
};

export const getConsensus = (req: Request, res: Response): void => {
  const requestPromises: Promise<AxiosResponse>[] = [];
  bytecoin.networkNodes.forEach(({ nodeAddress }) => {
    const request = {
      method: 'get',
      url: nodeAddress + '/blockchain',
    };
    requestPromises.push(axios(request));
  });

  Promise.all(requestPromises).then((blockchainsData) => {
    const currentChainLength = bytecoin.chain.length;
    let maxChainLength = currentChainLength;
    let newLongestChain = bytecoin.chain;
    let newPendingTransactions = bytecoin.pendingTransactions;
    blockchainsData.forEach(({ data: blockchain }) => {
      if (blockchain.chain.length > maxChainLength) {
        maxChainLength = blockchain.chain.length;
        newLongestChain = blockchain.chain;
        newPendingTransactions = blockchain.pendingTransactions;
      }
    });
    if (!newLongestChain || (newLongestChain && !bytecoin.isChainValid(newLongestChain))) {
      res.json({
        note: `Current chain has not been replaced.`,
        chain: bytecoin.chain,
      });
    } else {
      bytecoin.updateChain({
        chain: newLongestChain,
        pendingTransactions: newPendingTransactions,
      });
      res.json({ note: `This chain has been replaced.`, chain: bytecoin.chain });
    }
  });
};

export const postChallenge = (privateKey: KeyObject, req: Request, res: Response): void => {
  const { challenge, publicKey: nodePublickey } = req.body;
  if (!challenge || !nodePublickey) {
    res.status(400).json({ error: 'Invalid challenge request' });
    return;
  }
  const response = signMessage(challenge, privateKey); // Sign the challenge with the private key
  res.status(200).json({ response, publicKey: bytecoin.getCurrentNodePublicKey() });
};
