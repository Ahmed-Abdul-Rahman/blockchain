export { DataPropagationInterface } from './src/data-propagation/DataPropagationInterface';
export { GossipSubPropagation } from './src/data-propagation/GossipSubPropagation';
export { PropagatedMessage, PropagationContext } from './src/data-propagation/types';

export { genEd25519KeyPair } from './src/networking/auth';
export { PeerExchangeService } from './src/networking/PeerExchangeService';
export { SimplePeerScorer } from './src/networking/SimplePeerScorer';
export { NodeKey } from './src/networking/types';

export { createLibp2pNode, createNode } from './src/node';
export { NodeComponents, NodeOptions } from './src/types';
