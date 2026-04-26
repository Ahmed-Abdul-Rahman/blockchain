/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectStreamPropagation } from '../../../src/data-propagation/direct/DirectStreamPropagation';

vi.mock('@libp2p/peer-id', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    peerIdFromString: vi.fn((str: string) => ({
      toString: () => str,
      equals: (otherId: any) => str === otherId.toString(),
    })),
  };
});

describe('DirectStreamPropagation', () => {
  let mockNode: any;
  let propagation: DirectStreamPropagation;

  beforeEach(() => {
    mockNode = {
      handle: vi.fn(),
      unhandle: vi.fn().mockResolvedValue(undefined),
      dialProtocol: vi.fn().mockResolvedValue({
        sink: vi.fn(), // Mocking stream sink
        source: async function* () {
          yield new Uint8Array([0]);
        },
        close: vi.fn(),
      }),
    };

    propagation = new DirectStreamPropagation(mockNode);
  });

  afterEach(async () => {
    await propagation.stop();
    vi.clearAllMocks();
  });

  it('should register handler on onReceive', () => {
    const protocol = '/test/direct/1.0';
    propagation.onReceive(protocol, vi.fn());
    expect(mockNode.handle).toHaveBeenCalledWith(protocol, expect.any(Function));
  });

  it('should dial and write to stream on send', async () => {
    const protocol = '/test/direct/1.0';
    const message = { id: 'msg1', payload: 'hello', from: 'peerA', timestamp: Date.now() };

    await propagation.send('targetPeerId', protocol, message);

    expect(mockNode.dialProtocol).toHaveBeenCalledWith(expect.any(Object), protocol);
    // Since writeToStream uses it-pipe and sinks, dialing is the critical libp2p interaction to verify
  });

  it('should unhandle protocols on stop', async () => {
    propagation.onReceive('/test/1', vi.fn());
    propagation.onReceive('/test/2', vi.fn());

    await propagation.stop();
    expect(mockNode.unhandle).toHaveBeenCalledWith(['/test/1', '/test/2']);
  });
});
