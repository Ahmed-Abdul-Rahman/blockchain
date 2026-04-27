/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectStreamPropagation } from '../../../src/data-propagation/direct/DirectStreamPropagation';
import { DeChatComponents } from '../../../src/types';

describe('DirectStreamPropagation', () => {
  let propagation: DirectStreamPropagation;
  let mockComponents: Partial<DeChatComponents>;
  let mockNode: any;

  beforeEach(() => {
    mockNode = {
      handle: vi.fn(),
      unhandle: vi.fn(),
      dialProtocol: vi.fn(),
    };

    mockComponents = {
      libp2p: mockNode as any,
      // Added missing config structure for direct propagation
      config: {
        strategies: {
          propagation: {
            direct: {},
          },
        },
      } as any,
    };

    propagation = new DirectStreamPropagation(mockComponents as DeChatComponents);
  });

  afterEach(async () => {
    // Safely stop in case beforeEach fails
    await propagation?.stop();
    vi.clearAllMocks();
  });

  it('should register handler on onReceive', () => {
    const handler = vi.fn();
    propagation.onReceive('/test/1.0.0', handler);
    expect(mockNode.handle).toHaveBeenCalledWith('/test/1.0.0', expect.any(Function));
  });

  it('should dial and write to stream on send', async () => {
    const mockStream = { sink: vi.fn() };
    mockNode.dialProtocol.mockResolvedValueOnce(mockStream);
    const message = { id: 'msg1', payload: 'hello', from: 'peerA', timestamp: Date.now() };

    await propagation.send('target-peer', '/test/1.0.0', message);

    expect(mockNode.dialProtocol).toHaveBeenCalledWith(expect.anything(), '/test/1.0.0');
  });

  it('should unhandle protocols on stop', async () => {
    propagation.onReceive('/test/1.0.0', vi.fn());
    await propagation.stop();
    expect(mockNode.unhandle).toHaveBeenCalledWith('/test/1.0.0');
  });
});
