import { describe, it } from 'vitest';
import { simulateBurstPeersAtStartUp } from './InterOpScenarios';

describe('P2P Network Integration Tests', () => {
  it('Burst startup: 10 nodes at once', async () => {
    await simulateBurstPeersAtStartUp(10);
  });
});
