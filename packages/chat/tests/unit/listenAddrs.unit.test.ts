import { describe, expect, it } from 'vitest';
import {
  LAN_HYBRID_LISTEN_ADDRS,
  LOCAL_HYBRID_LISTEN_ADDRS,
  pickTcpListenAddr,
  pickWsListenAddr,
  requireWsBootstrapPeers,
  resolveBootstrapListenAddrs,
} from '../../src/bootstrap/listenAddrs';

describe('bootstrap listen addrs', () => {
  const addrs = ['/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWTcp', '/ip4/127.0.0.1/tcp/4002/ws/p2p/12D3KooWWs'];

  it('picks TCP without /ws and WS separately', () => {
    expect(pickTcpListenAddr(addrs)).toContain('/tcp/4001/');
    expect(pickWsListenAddr(addrs)).toContain('/ws/');
  });

  it('throws when the expected transport is missing', () => {
    expect(() => pickWsListenAddr(['/ip4/127.0.0.1/tcp/1/p2p/x'])).toThrow(/\/ws/);
    expect(() => pickTcpListenAddr(['/ip4/127.0.0.1/tcp/1/ws/p2p/x'])).toThrow(/TCP/);
  });

  it('requires a /ws or /wss bootstrap multiaddr for browser clients', () => {
    expect(() => requireWsBootstrapPeers([])).toThrow(/at least one/);
    expect(() => requireWsBootstrapPeers(['/ip4/127.0.0.1/tcp/1/p2p/x'])).toThrow(/\/ws/);
    expect(requireWsBootstrapPeers(['/ip4/127.0.0.1/tcp/1/ws/p2p/x'])).toHaveLength(1);
    expect(requireWsBootstrapPeers(['/dns4/chat.example/tcp/443/wss/p2p/x'])[0]).toContain('/wss/');
  });

  it('publishes hybrid listen recipes', () => {
    expect(LOCAL_HYBRID_LISTEN_ADDRS).toEqual(['/ip4/127.0.0.1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws']);
    expect(LAN_HYBRID_LISTEN_ADDRS).toEqual(['/ip4/0.0.0.0/tcp/0', '/ip4/0.0.0.0/tcp/0/ws']);
  });

  it('falls back to LAN hybrid listen when bootstrap addrs are omitted or empty', () => {
    expect(resolveBootstrapListenAddrs(undefined)).toEqual([...LAN_HYBRID_LISTEN_ADDRS]);
    expect(resolveBootstrapListenAddrs([])).toEqual([...LAN_HYBRID_LISTEN_ADDRS]);
    expect(resolveBootstrapListenAddrs(['/ip4/127.0.0.1/tcp/0'])).toEqual(['/ip4/127.0.0.1/tcp/0']);
  });
});
