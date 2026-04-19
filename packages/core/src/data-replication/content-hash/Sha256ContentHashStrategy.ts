import { createHash } from 'crypto';
import { canonicalSerialize } from '../serializers';
import { ContentHashStrategy } from './types';

export class Sha256ContentHashStrategy implements ContentHashStrategy {
  public readonly algorithm = 'sha256';

  public readonly hash = <T>(data: T): string => {
    const bytes = canonicalSerialize(data);
    return createHash('sha256').update(bytes).digest('hex');
  };
}
