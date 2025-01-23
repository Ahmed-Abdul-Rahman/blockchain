// import { BlockChain } from './blockchain.js';
// import testData from './testData.json' with { type: "json" };
// const bitcoin = new BlockChain();

// bitcoin.createNewTransaction(100, { message: 'Sending Money to Alice' }, '12312KDFKLSDJSDF', '3290SHDFL932NWEL');
// bitcoin.createNewTransaction(100, { message: 'Sending Money to Alice' }, '12312KDFKLSDJSDF', '3290SHDFL932NWEL');
// bitcoin.createNewTransaction(100, { message: 'Sending Money to Alice' }, '12312KDFKLSDJSDF', '3290SHDFL932NWEL');

// console.log(bitcoin.isChainValid(testData.chain));

const log = (one, two, three) => {
  console.log(one, two, three);
};
const boundLog = log.bind(null, 1);
boundLog(5, 6); // "this value", 1, 2, 3, 4, 5, 6
