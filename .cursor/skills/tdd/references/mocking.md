# When to Mock

Mock at **system boundaries** only:

- External APIs (payment, email, etc.)
- Databases (sometimes - prefer test DB)
- Time/randomness
- File system (sometimes)

Don't mock:

- Your own classes/modules
- Internal collaborators
- Anything you control

## DeChat boundaries

In `@dechat/core` unit tests, mock only these external boundaries:

| Boundary | How |
|----------|-----|
| **libp2p** | `vi.fn()` stubs for `dial`, `handle`, `getConnections`, `peerId` |
| **@noble/ed25519** | `vi.mock('@noble/ed25519')` in auth tests |
| **level (LevelDB)** | `vi.mock('level')` in store tests |

Do **not** mock DeChat networking modules (`PeerRegistry`, `DialQueue`, `GossipSubPropagation`, etc.) against each other — compose real instances with a mocked `libp2p` and `Partial<DeChatComponents>` instead.

Reference pattern: `packages/core/tests/unit/networking/PeerAuthenticator.unit.test.ts`, `packages/core/tests/unit/data-propagation/GossipSubPropagation.unit.test.ts`.

For cross-node behaviour, use the interop harness (`configureNode()` in `workerUitls.ts`) — not mocks.

## Designing for Mockability

At system boundaries, design interfaces that are easy to mock:

**1. Use dependency injection**

Pass external dependencies in rather than creating them internally:

```typescript
// Easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. Prefer SDK-style interfaces over generic fetchers**

Create specific functions for each external operation instead of one generic function with conditional logic:

```typescript
// GOOD: Each function is independently mockable
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// BAD: Mocking requires conditional logic inside the mock
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

The SDK approach means:
- Each mock returns one specific shape
- No conditional logic in test setup
- Easier to see which endpoints a test exercises
- Type safety per endpoint
