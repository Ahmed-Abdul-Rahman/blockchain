import {
  AntiEntropyMetrics,
  AuthMetrics,
  BasicAntiEntropyMetrics,
  BasicAuthMetrics,
  BasicDialQueueMetrics,
  BasicGossipSubPropagationMetrics,
  BasicPeerExchangeMetrics,
  BasicPeerRegistryMetrics,
  DialQueueMetrics,
  NoopAntiEntropyMetrics,
  NoopAuthMetrics,
  NoopDialQueueMetrics,
  NoopGossipMetrics,
  NoopPeerExchangeMetrics,
  NoopPeerRegistryMetrics,
  PeerExchangeServiceMetrics,
  PeerRegistryMetrics,
} from './metrics';
import { GossipSubPropagationMetrics } from './metrics/interfaces/GossipSubPropagationMetrics';

export const getMetricsInstances = (enableMetrics: boolean | undefined) => {
  const antiEntropy: AntiEntropyMetrics = enableMetrics ? new BasicAntiEntropyMetrics() : new NoopAntiEntropyMetrics();

  if (enableMetrics) {
    return {
      peerRegistry: new BasicPeerRegistryMetrics(),
      pexService: new BasicPeerExchangeMetrics(),
      dialQueue: new BasicDialQueueMetrics(),
      authMetrics: new BasicAuthMetrics(),
      gossipSubPropMetrics: new BasicGossipSubPropagationMetrics(),
      antiEntropy,
    };
  }
  return {
    peerRegistry: new NoopPeerRegistryMetrics(),
    pexService: new NoopPeerExchangeMetrics(),
    dialQueue: new NoopDialQueueMetrics(),
    authMetrics: new NoopAuthMetrics(),
    gossipSubPropMetrics: new NoopGossipMetrics(),
    antiEntropy,
  };
};

export type DeChatMetricsInstances = {
  dialQueue: DialQueueMetrics;
  pexService: PeerExchangeServiceMetrics;
  peerRegistry: PeerRegistryMetrics;
  authMetrics: AuthMetrics;
  gossipSubPropMetrics: GossipSubPropagationMetrics;
  antiEntropy: AntiEntropyMetrics;
};
