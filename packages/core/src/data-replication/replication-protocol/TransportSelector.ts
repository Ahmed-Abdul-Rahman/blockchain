import { ReplicationMessageType } from './ReplicationProtocolInterface';

export class TransportSelector {
  // Enforce ANNOUNCE -> gossip, others -> direct
  select(messageType: ReplicationMessageType): 'gossip' | 'direct' {
    if (messageType === 'replication_announce') return 'gossip';
    return 'direct';
  }
}
