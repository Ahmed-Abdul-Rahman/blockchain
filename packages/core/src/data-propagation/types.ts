import { PeerId } from '@libp2p/interface';

export interface PropagatedMessage<T> {
  /** payload content hash or UUID */
  id: string;
  /** payload message to be sent */
  payload: T;
  /** From PeerId string */
  from: string;
  /** Timestamp at which this message was generated */
  timestamp: number;
  /** signature, optional but recommended */
  signature?: Uint8Array;
}

export interface PropagationContext {
  /** From PeerId string */
  from: PeerId;
  /** Timestamp at which this message was received */
  receivedAt: number;
  /** Optional GossipSub Topic on which the message is received*/
  topic?: string;
}
