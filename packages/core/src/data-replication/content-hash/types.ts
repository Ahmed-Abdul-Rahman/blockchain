import { ContentHash } from '../types';

export interface ContentHashStrategy {
  /**
   * Returns a deterministic content hash for the given data.
   * Must be stable across nodes.
   */
  hash<T>(data: T): ContentHash;

  /**
   * Identifier of the hashing algorithm (useful for metadata & upgrades)
   */
  readonly algorithm: string;
}
