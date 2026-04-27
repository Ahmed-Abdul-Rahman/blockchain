import { DeChatFactory } from '../../types';
import { ReplicationMessageType } from './ReplicationProtocolInterface';

export class TransportSelector {
  private readonly rules: ReadonlyMap<ReplicationMessageType, 'gossip' | 'direct'> = new Map([
    ['replication_announce', 'gossip'],
    ['replication_request', 'direct'],
    ['replication_content', 'direct'],
    ['replication_error', 'direct'],
  ]);

  public readonly select = (messageType: ReplicationMessageType): 'gossip' | 'direct' => {
    return this.rules.get(messageType) ?? 'direct';
  };
}

export const transportSelector = (): TransportSelector => new TransportSelector();
