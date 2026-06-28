# Wire Codec Performance Report

Generated: 2026-06-28T12:55:09.580Z
Node.js: v22.13.0

Compares `createJsonWireSerializer()` vs `createCborWireSerializer()` using realistic DeChat payloads.
Run locally with `yarn workspace @dechat/core bench:wire`.

## Summary

- **Wire size**: CBOR is smaller, especially for binary-heavy replication payloads.
- **Decode throughput**: CBOR decode ops/sec and p99 latency should improve vs JSON.
- **Event-loop delay**: Lower p99/max implies less main-thread blocking during decode storms.

## Results

### propagated-message-1kb

GossipSub PropagatedMessage with ~1KB text payload and signature

| Metric | JSON | CBOR | CBOR vs JSON |
| --- | ---: | ---: | ---: |
| Wire size | 1.2 KB | 1.1 KB | 4.1% smaller |
| Serialize ops/sec | 271168 | 627746 | 2.31× faster |
| Deserialize ops/sec | 213952 | 903737 | 4.22× faster |
| Deserialize p99 (ms) | 0.0062 | 0.0023 | 2.73× faster |
| Event-loop p99 (ms, 2000 decodes) | 0.0005 | 0.0005 | 1.00× lower |
| Event-loop max (ms) | 0.0000 | 0.0000 | n/a× lower |

### propagated-message-8kb

PropagatedMessage with ~8KB text and metadata

| Metric | JSON | CBOR | CBOR vs JSON |
| --- | ---: | ---: | ---: |
| Wire size | 8.6 KB | 8.4 KB | 2.5% smaller |
| Serialize ops/sec | 43971 | 283500 | 6.45× faster |
| Deserialize ops/sec | 35921 | 440627 | 12.27× faster |
| Deserialize p99 (ms) | 0.0375 | 0.0055 | 6.86× faster |
| Event-loop p99 (ms, 1000 decodes) | 0.0005 | 0.0005 | 1.00× lower |
| Event-loop max (ms) | 0.0000 | 0.0000 | n/a× lower |

### replication-content-64kb

ReplicationContent with 64KB Uint8Array blob

| Metric | JSON | CBOR | CBOR vs JSON |
| --- | ---: | ---: | ---: |
| Wire size | 228.7 KB | 64.1 KB | 72.0% smaller |
| Serialize ops/sec | 233 | 175627 | 755.14× faster |
| Deserialize ops/sec | 44 | 1181073 | 26989.42× faster |
| Deserialize p99 (ms) | 32.8889 | 0.0011 | 30340.33× faster |
| Event-loop p99 (ms, 500 decodes) | 0.0005 | 0.0005 | 1.00× lower |
| Event-loop max (ms) | 0.0000 | 0.0000 | n/a× lower |

### replication-content-256kb

ReplicationContent with 256KB Uint8Array blob (storm-sized frame)

| Metric | JSON | CBOR | CBOR vs JSON |
| --- | ---: | ---: | ---: |
| Wire size | 914.2 KB | 256.1 KB | 72.0% smaller |
| Serialize ops/sec | 59 | 50797 | 867.68× faster |
| Deserialize ops/sec | 9 | 1944897 | 205294.58× faster |
| Deserialize p99 (ms) | 154.4662 | 0.0007 | 205955.01× faster |
| Event-loop p99 (ms, 200 decodes) | 0.0005 | 0.0005 | 1.00× lower |
| Event-loop max (ms) | 0.0000 | 0.0000 | n/a× lower |

## Notes

- Benchmarks are best-effort and machine-dependent; do not gate CI on absolute numbers.
- Event-loop figures measure delay while hammering `deserialize` on the main thread.
- Both codecs include the 1-byte wire format prefix used in production.
