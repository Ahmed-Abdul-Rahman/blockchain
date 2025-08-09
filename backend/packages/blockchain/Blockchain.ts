import { KeyObject } from 'crypto';
import { v1 as uuidV1 } from 'uuid';
import { sha256 } from '@common/utils';

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
  nodeUUID: string | null | undefined;
  publicKey: KeyObject | null;
}

class BlockChain {
  chain: Block[];
  pendingTransactions: Transaction[];
  currentNode: Node;
  networkNodes: Node[];

  private static _instance: BlockChain;

  private constructor() {
    this.chain = [];
    this.pendingTransactions = [];
    this.createNewBlock(1000, '0', '0000'); // genesis block creation
    this.currentNode = { nodeAddress: null, nodeUUID: null, publicKey: null };
    this.networkNodes = [];
  }

  public static get Instance(): BlockChain {
    return this._instance || (this._instance = new this());
  }

  setCurrentNode(nodeAddress: string, nodeUUID: string | undefined, publicKey: KeyObject): void {
    this.currentNode = { nodeAddress, nodeUUID, publicKey };
  }

  getCurrentNode(): object {
    const { nodeAddress, publicKey } = this.currentNode;
    return {
      nodeAddress,
      publicKey: publicKey?.export({ type: 'spki', format: 'pem' }),
    };
  }

  getNetworkNodeCount(): number {
    return this.networkNodes.length;
  }

  getCurrentNodePublicKey(): string | Buffer<ArrayBufferLike> | null {
    return this.currentNode.publicKey?.export({ type: 'spki', format: 'pem' }) || null;
  }

  createNewBlock(nonce: number, previousBlockHash: string, hash: string): Block {
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

  getLastBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  createNewTransaction(amount: number, data: object, senderAddress: string, recipientAddress: string): Transaction {
    return {
      amount,
      data,
      sender: senderAddress,
      recipient: recipientAddress,
      timestamp: Date.now(),
      transactionId: uuidV1().split('-').join(''),
    };
  }

  addTransactionToPendingTransactions(newTransaction: Transaction): number {
    this.pendingTransactions.push(newTransaction);
    return this.getLastBlock().index + 1; // return the block number in which this newTransaction will reside
  }

  getBlockData(block: Block) {
    return {
      index: block.index,
      transactions: block.transactions,
    };
  }

  getPendingBlockData(): Partial<Block> {
    return {
      index: this.getLastBlock().index + 1,
      transactions: this.pendingTransactions,
    };
  }

  hashBlock(previousBlockHash: string, currentBlockData: Partial<Block>, nonce: number): string {
    const dataString = previousBlockHash + nonce + JSON.stringify(currentBlockData);
    return sha256(dataString);
  }

  isValidHash(hash: string, criteria: string = '0000'): boolean {
    return hash.substring(0, 4) === criteria;
  }

  proofOfWork(previousBlockHash: string, currentBlockData: Partial<Block>): number {
    let nonce = 0;
    let hash = sha256(`${previousBlockHash}${currentBlockData}${nonce}`);
    while (!this.isValidHash(hash)) {
      nonce += 1;
      hash = this.hashBlock(previousBlockHash, currentBlockData, nonce);
    }
    return nonce;
  }

  isValidBlock(newBlock: Block): boolean {
    const lastBlock = this.getLastBlock();
    const isValidHash = lastBlock.hash === newBlock.previousBlockHash;
    const isIndexValid = lastBlock.index + 1 === newBlock.index;
    return isValidHash && isIndexValid;
  }

  addNewBlock(newBlock: Block): void {
    this.chain.push(newBlock);
    this.pendingTransactions = [];
  }

  isChainValid(blockchain: Block[]): boolean {
    for (let i = 1; i < blockchain.length; i++) {
      const currentBlock = blockchain[i];
      const previousBlock = blockchain[i - 1];
      const isValidPreviousHash = previousBlock.hash === currentBlock.previousBlockHash;
      const hash = this.hashBlock(previousBlock.hash, this.getBlockData(currentBlock), currentBlock.nonce);
      if (!this.isValidHash(hash) || !isValidPreviousHash) return false;
    }
    const genesisBlock = blockchain[0];
    const { index, transactions, nonce, previousBlockHash, hash } = genesisBlock;
    if (index !== 1 || transactions.length !== 0 || nonce !== 1000 || previousBlockHash !== '0' || hash !== '0000')
      return false;
    return true;
  }

  updateChain(blockchain: { chain: Block[]; pendingTransactions: Transaction[] }): void {
    this.chain = blockchain.chain;
    this.pendingTransactions = blockchain.pendingTransactions;
  }

  getMiningRewardTransaction(): object {
    return {
      amount: 12.5,
      data: { message: `You have been given ${12.5} coin as a mining reward!` },
      senderAddress: '0000',
      recipientAddress: this.currentNode.nodeUUID,
    };
  }
}

const bytecoin = BlockChain.Instance;

export default bytecoin;
