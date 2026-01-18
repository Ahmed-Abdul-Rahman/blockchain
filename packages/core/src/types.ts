import { Libp2p } from 'libp2p';
import { HealthChecker } from './metricsCollection/HealthChecker';
import { MetricsCollector } from './metricsCollection/MetricsCollector';
import { PeerExchangeService } from './networking/PeerExchangeService';
import { SimplePeerScorer } from './networking/SimplePeerScorer';

export interface NodeOptions {
  /** Enable Multicast DNS */
  mdns?: boolean;

  /** override listen multiaddrs */
  listenTcp?: string[];

  /** override bootstrap multiaddrs */
  bootstrap?: string[];

  /** Initial bootstrap peers to be loaded */
  peerSeeds?: { peerId: string; addresses: string[] }[];

  /** Time to interact with a newly discovered peer and on board it to the network */
  onBoardingPeerTime?: number;

  /** Maximum direct peer connections to be maintained */
  maxConnections?: number;

  /** Enable metrics for peer connectivity analysis */
  enableMetrics?: boolean;

  /** Collect metrics at this interval*/
  metricsInterval?: number;
}

export interface NodeComponents {
  node: Libp2p;
  scorer: SimplePeerScorer;
  pexService: PeerExchangeService;
  metrics: MetricsCollector;
  health: HealthChecker;
  nodeCleanUp: () => void;
}
