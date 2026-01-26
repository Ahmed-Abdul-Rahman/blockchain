export { BroadcastPropagationInterface } from './src/data-propagation/broadcast/BroadcastPropagationInterface';
export { GossipSubPropagation } from './src/data-propagation/broadcast/GossipSubPropagation';
export { DirectPropagationInterface } from './src/data-propagation/direct/DirectPropagationInterface';
export { DirectStreamPropagation } from './src/data-propagation/direct/DirectStreamPropagation';
export { PropagatedMessage, PropagationContext } from './src/data-propagation/types';

export { genEd25519KeyPair } from './src/networking/auth';
export { PeerExchangeService } from './src/networking/PeerExchangeService';
export { SimplePeerScorer } from './src/networking/SimplePeerScorer';
export { NodeKey } from './src/networking/types';

export { createLibp2pNode, createNode } from './src/node';
export { NodeComponents, NodeOptions } from './src/types';
