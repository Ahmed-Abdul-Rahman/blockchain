import { sha256 } from '@dechat/crypto';
import { canonicalSerialize } from '../../shared/serializers';
import { DeChatFactory } from '../../types';
import { ContentHashStrategyInterface } from './types';

export class Sha256ContentHashStrategy implements ContentHashStrategyInterface {
  public readonly algorithm = 'sha256';

  public readonly hash = <T>(data: T): string => {
    const bytes = canonicalSerialize(data);
    return sha256(bytes);
  };
}

export const contentHashStrategy = (): DeChatFactory<ContentHashStrategyInterface> => {
  return (components) => new Sha256ContentHashStrategy();
};
