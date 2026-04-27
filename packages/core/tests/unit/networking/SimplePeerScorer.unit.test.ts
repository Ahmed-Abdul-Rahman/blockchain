import { beforeEach, describe, expect, it } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../src/config/defaults';
import { SimplePeerScorer, simplePeerScorer } from '../../../src/networking/SimplePeerScorer';
import { DeChatComponents } from '../../../src/types';

describe('SimplePeerScorer', () => {
  let mockComponents: Partial<DeChatComponents>;
  let scorer: SimplePeerScorer;

  beforeEach(() => {
    mockComponents = {
      config: DECHAT_DEFAULTS,
    };
    scorer = simplePeerScorer()(mockComponents as DeChatComponents);
  });

  it('rewards and penalizes; dialable threshold works', () => {
    scorer.reward('p1', 5);
    expect(scorer.get('p1')).toBe(5);

    scorer.penalize('p1', 10);
    expect(scorer.get('p1')).toBe(-5);

    // Default minDialableScore is -2
    expect(scorer.isDialable('p1')).toBe(false);

    scorer.reward('p1', 4);
    expect(scorer.get('p1')).toBe(-1);
    expect(scorer.isDialable('p1')).toBe(true);
  });

  it('caps scores at maxScore and minScore limits', () => {
    scorer.reward('p2', 200);
    expect(scorer.get('p2')).toBe(DECHAT_DEFAULTS.scoring.maxScore);

    scorer.penalize('p3', 100);
    expect(scorer.get('p3')).toBe(DECHAT_DEFAULTS.scoring.minScore);
  });
});
