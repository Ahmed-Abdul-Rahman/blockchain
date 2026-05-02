import {
  BasicAuthMetrics,
  BasicDialQueueMetrics,
  BasicGossipSubPropagationMetrics,
  BasicPeerExchangeMetrics,
  BasicPeerRegistryMetrics,
  NoopAuthMetrics,
  NoopDialQueueMetrics,
  NoopGossipMetrics,
  NoopPeerExchangeMetrics,
  NoopPeerRegistryMetrics,
} from './metrics';

export const getMetricsInstances = (enableMetrics: boolean | undefined) => {
  if (enableMetrics) {
    return {
      peerRegistry: new BasicPeerRegistryMetrics(),
      pexService: new BasicPeerExchangeMetrics(),
      dialQueue: new BasicDialQueueMetrics(),
      authMetrics: new BasicAuthMetrics(),
      gossipSubPropMetrics: new BasicGossipSubPropagationMetrics(),
    };
  }
  return {
    peerRegistry: new NoopPeerRegistryMetrics(),
    pexService: new NoopPeerExchangeMetrics(),
    dialQueue: new NoopDialQueueMetrics(),
    authMetrics: new NoopAuthMetrics(),
    gossipSubPropMetrics: new NoopGossipMetrics(),
  };
};
