import { ContentHash, DataSerializer } from '../data-replication/types';

export interface ReplicaStoreInterface {
  /**
   * Checks if the data associated with a specific hash exists in the store.
   * @param hash - The unique content-addressable identifier.
   * @returns A promise resolving to true if found, false otherwise.
   */
  has: (hash: ContentHash) => Promise<boolean>;

  /**
   * Retrieves the raw data for a given hash.
   * @param hash - The unique content-addressable identifier.
   * @returns A promise resolving to the data bytes, or null if not found.
   */
  get: (hash: ContentHash) => Promise<Uint8Array | null>;

  /**
   * Stores data indexed by its hash.
   * @param hash - The unique content-addressable identifier.
   * @param data - The raw bytes to store.
   * @throws Will throw if the storage is full or the media is read-only.
   */
  put: (hash: ContentHash, data: Uint8Array) => Promise<void>;

  // TODO: Storing large files (chat history with images/videos), a simple Uint8Array in put and get will be slow.
  // TODO: Implement a getStream and putStream method for large files

  /**
   * Removes the data associated with a hash from local storage.
   * @param hash - The unique content-addressable identifier.
   */
  delete: (hash: ContentHash) => Promise<void>;

  /**
   * Returns a list of all content hashes currently held in the store.
   * For very large stores, returns an AsyncIterable instead.
   */
  keys: () => Promise<readonly ContentHash[] | AsyncIterable<ContentHash>>;

  /**
   * Returns a list of all Uint8Array data currently held in the store.
   * For very large stores, returns an AsyncIterable instead.
   */
  values: () => Promise<readonly Uint8Array[] | AsyncIterable<Uint8Array>>;

  /**
   * Returns a MapIterator of all entries currently held in the store.
   * For very large stores, returns an AsyncIterable instead.
   */
  entries: () => Promise<MapIterator<[string, Uint8Array<ArrayBufferLike>]>>;

  /**
   * Clears all entries from the store.
   * Useful for cache resets or node teardowns.
   */
  clear: () => Promise<void>;

  /**
   * Returns the total number of items in the store.
   */
  size: () => Promise<number>;

  /**
   * Closes the storage engine
   */
  close: () => Promise<void>;

  serializer: DataSerializer;
}
