import { v1 as uuidV1 } from 'uuid';
import { KeyObject } from 'crypto';
import { sha256 } from '@common/crypto';

interface Transaction {
  amount: number;
  data: object;
  sender: string;
  recipient: string;
  timestamp: number;
  transactionId: string;
}

interface Block {
  index: number;
  timestamp: number;
  transactions: Transaction[];
  nonce: number;
  previousBlockHash: string;
  hash: string;
}

interface Node {
  nodeAddress: string | null;
  nodeUUID: string | null;
  publicKey: KeyObject | null;
}

class BlockChain {
  chain: Block[];
  pendingTransactions: Transaction[];
  currentNode: Node;
  networkNodes: Node[];

  constructor() {
    this.chain = [];
    this.pendingTransactions = [];
    this.createNewBlock(1000, '0', '0000'); // genesis block creation
    this.currentNode = { nodeAddress: null, nodeUUID: null, publicKey: null };
    this.networkNodes = [];
  }

  setCurrentNode(nodeAddress, nodeUUID, publicKey) {
    this.currentNode = { nodeAddress, nodeUUID, publicKey };
  }

  getCurrentNode() {
    const { nodeAddress, publicKey } = this.currentNode;
    return { nodeAddress, publicKey: publicKey?.export({ type: 'spki', format: 'pem' }) };
  }

  getCurrentNodePublicKey() {
    return this.currentNode.publicKey?.export({ type: 'spki', format: 'pem' });
  }

  createNewBlock(nonce, previousBlockHash, hash) {
    const newBlock = {
      index: this.chain.length + 1,
      timestamp: Date.now(),
      transactions: this.pendingTransactions,
      nonce,
      previousBlockHash,
      hash,
    };
    this.pendingTransactions = [];
    this.chain.push(newBlock);
    return newBlock;
  }

  getLastBlock() {
    return this.chain[this.chain.length - 1];
  }

  createNewTransaction(amount, data, senderAddress, recipientAddress) {
    return {
      amount,
      data,
      sender: senderAddress,
      recipient: recipientAddress,
      timestamp: Date.now(),
      transactionId: uuidV1().split('-').join(''),
    };
  }

  addTransactionToPendingTransactions(newTransaction) {
    this.pendingTransactions.push(newTransaction);
    return this.getLastBlock()['index'] + 1; // return the block number in which this newTransaction will reside
  }

  getBlockData(block) {
    return {
      index: block['index'],
      transactions: block['transactions'],
    };
  }

  getPendingBlockData() {
    return {
      index: this.getLastBlock()['index'] + 1,
      transactions: this.pendingTransactions,
    };
  }

  hashBlock(previousBlockHash, currentBlockData, nonce) {
    const dataString = previousBlockHash + nonce + JSON.stringify(currentBlockData);
    return sha256(dataString);
  }

  isValidHash(hash, criteria = '0000') {
    return hash.substring(0, 4) === criteria;
  }

  proofOfWork(previousBlockHash, currentBlockData) {
    let nonce = 0;
    let hash = sha256(`${previousBlockHash}${currentBlockData}${nonce}`);
    while (!this.isValidHash(hash)) {
      nonce += 1;
      hash = this.hashBlock(previousBlockHash, currentBlockData, nonce);
    }
    return nonce;
  }

  isValidBlock(newBlock) {
    const lastBlock = this.getLastBlock();
    const isValidHash = lastBlock['hash'] === newBlock['previousBlockHash'];
    const isIndexValid = lastBlock['index'] + 1 === newBlock['index'];
    return isValidHash && isIndexValid;
  }

  addNewBlock(newBlock) {
    this.chain.push(newBlock);
    this.pendingTransactions = [];
  }

  isChainValid(blockchain) {
    for (let i = 1; i < blockchain.length; i++) {
      const currentBlock = blockchain[i];
      const previousBlock = blockchain[i - 1];
      const isValidPreviousHash = previousBlock['hash'] === currentBlock['previousBlockHash'];
      const hash = this.hashBlock(previousBlock['hash'], this.getBlockData(currentBlock), currentBlock['nonce']);
      if (!this.isValidHash(hash) || !isValidPreviousHash) return false;
    }
    const genesisBlock = blockchain[0];
    const { index, transactions, nonce, previousBlockHash, hash } = genesisBlock;
    if (index !== 1 || transactions.length !== 0 || nonce !== 1000 || previousBlockHash !== '0' || hash !== '0000')
      return false;
    return true;
  }

  updateChain(blockchain) {
    this.chain = blockchain.chain;
    this.pendingTransactions = blockchain.pendingTransactions;
  }

  getMiningRewardTransaction() {
    return {
      amount: 12.5,
      data: { message: `You have been given ${12.5} coin as a mining reward!` },
      senderAddress: '0000',
      recipientAddress: this.currentNode.nodeUUID,
    };
  }
}

const bitcoin = new BlockChain();

export default bitcoin;
