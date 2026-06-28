import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createCborWireSerializer } from '../../src/shared/serialization/cborWireSerializer';
import { createJsonWireSerializer } from '../../src/shared/serialization/jsonWireSerializer';
import type { WireCodec } from '../../src/shared/serialization/types';
import { WIRE_PAYLOAD_FIXTURES, type WirePayloadFixture } from './fixtures/wirePayloads';
import {
  type BenchResult,
  benchSync,
  type EventLoopDelayResult,
  formatBytes,
  formatNumber,
  speedup,
  warmup,
} from './lib/benchUtils';

export type WireCodecName = 'json' | 'cbor';

export interface CodecBenchRow {
  readonly codec: WireCodecName;
  readonly wireBytes: number;
  readonly serialize: BenchResult;
  readonly deserialize: BenchResult;
  readonly eventLoop: EventLoopDelayResult;
}

export interface PayloadBenchReport {
  readonly fixture: WirePayloadFixture;
  readonly json: CodecBenchRow;
  readonly cbor: CodecBenchRow;
}

export interface WireCodecBenchReport {
  readonly generatedAt: string;
  readonly nodeVersion: string;
  readonly payloads: readonly PayloadBenchReport[];
  readonly reportPath: string;
}

const CODECS: Readonly<Record<WireCodecName, WireCodec>> = {
  json: createJsonWireSerializer(),
  cbor: createCborWireSerializer(),
};

const measureEventLoopDelay = (fn: () => void, iterations: number): EventLoopDelayResult => {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();

  for (let i = 0; i < iterations; i++) {
    fn();
  }

  histogram.disable();

  return {
    iterations,
    meanMs: histogram.mean / 1_000_000,
    p99Ms: histogram.percentile(99) / 1_000_000,
    maxMs: histogram.max / 1_000_000,
  };
};

const benchCodecForPayload = (codecName: WireCodecName, fixture: WirePayloadFixture): CodecBenchRow => {
  const codec = CODECS[codecName];
  const value = fixture.value;

  warmup(() => {
    codec.serialize(value);
  });

  const wireBytes = codec.serialize(value).byteLength;
  const serialized = codec.serialize(value);

  warmup(() => {
    codec.deserialize(serialized);
  });

  const serialize = benchSync(() => {
    codec.serialize(value);
  }, fixture.serializeIterations);

  const deserialize = benchSync(() => {
    codec.deserialize(serialized);
  }, fixture.deserializeIterations);

  const eventLoop = measureEventLoopDelay(() => {
    codec.deserialize(serialized);
  }, fixture.eventLoopIterations);

  return {
    codec: codecName,
    wireBytes,
    serialize,
    deserialize,
    eventLoop,
  };
};

const renderPayloadSection = (row: PayloadBenchReport): string => {
  const wireReduction =
    row.json.wireBytes > 0 ? ((row.json.wireBytes - row.cbor.wireBytes) / row.json.wireBytes) * 100 : 0;

  return [
    `### ${row.fixture.id}`,
    '',
    row.fixture.description,
    '',
    '| Metric | JSON | CBOR | CBOR vs JSON |',
    '| --- | ---: | ---: | ---: |',
    `| Wire size | ${formatBytes(row.json.wireBytes)} | ${formatBytes(row.cbor.wireBytes)} | ${formatNumber(wireReduction, 1)}% smaller |`,
    `| Serialize ops/sec | ${formatNumber(row.json.serialize.opsPerSec, 0)} | ${formatNumber(row.cbor.serialize.opsPerSec, 0)} | ${formatNumber(row.cbor.serialize.opsPerSec / Math.max(row.json.serialize.opsPerSec, 1), 2)}× faster |`,
    `| Deserialize ops/sec | ${formatNumber(row.json.deserialize.opsPerSec, 0)} | ${formatNumber(row.cbor.deserialize.opsPerSec, 0)} | ${formatNumber(row.cbor.deserialize.opsPerSec / Math.max(row.json.deserialize.opsPerSec, 1), 2)}× faster |`,
    `| Deserialize p99 (ms) | ${formatNumber(row.json.deserialize.p99Ms, 4)} | ${formatNumber(row.cbor.deserialize.p99Ms, 4)} | ${formatNumber(speedup(row.json.deserialize.p99Ms, row.cbor.deserialize.p99Ms), 2)}× faster |`,
    `| Event-loop p99 (ms, ${row.fixture.eventLoopIterations} decodes) | ${formatNumber(row.json.eventLoop.p99Ms, 4)} | ${formatNumber(row.cbor.eventLoop.p99Ms, 4)} | ${formatNumber(speedup(row.json.eventLoop.p99Ms, row.cbor.eventLoop.p99Ms), 2)}× lower |`,
    `| Event-loop max (ms) | ${formatNumber(row.json.eventLoop.maxMs, 4)} | ${formatNumber(row.cbor.eventLoop.maxMs, 4)} | ${formatNumber(speedup(row.json.eventLoop.maxMs, row.cbor.eventLoop.maxMs), 2)}× lower |`,
    '',
  ].join('\n');
};

export const renderWireCodecBenchMarkdown = (report: WireCodecBenchReport): string => {
  const sections = report.payloads.map(renderPayloadSection).join('\n');

  return [
    '# Wire Codec Performance Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Node.js: ${report.nodeVersion}`,
    '',
    'Compares `createJsonWireSerializer()` vs `createCborWireSerializer()` using realistic DeChat payloads.',
    'Run locally with `yarn workspace @dechat/core bench:wire`.',
    '',
    '## Summary',
    '',
    '- **Wire size**: CBOR is smaller, especially for binary-heavy replication payloads.',
    '- **Decode throughput**: CBOR decode ops/sec and p99 latency should improve vs JSON.',
    '- **Event-loop delay**: Lower p99/max implies less main-thread blocking during decode storms.',
    '',
    '## Results',
    '',
    sections,
    '## Notes',
    '',
    '- Benchmarks are best-effort and machine-dependent; do not gate CI on absolute numbers.',
    '- Event-loop figures measure delay while hammering `deserialize` on the main thread.',
    '- Both codecs include the 1-byte wire format prefix used in production.',
    '',
  ].join('\n');
};

export const runWireCodecBenchmark = async (): Promise<WireCodecBenchReport> => {
  const payloads: PayloadBenchReport[] = WIRE_PAYLOAD_FIXTURES.map((fixture) => ({
    fixture,
    json: benchCodecForPayload('json', fixture),
    cbor: benchCodecForPayload('cbor', fixture),
  }));

  const perfDir = dirname(fileURLToPath(import.meta.url));
  const reportsDir = join(perfDir, 'reports');
  await mkdir(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(reportsDir, `wire-codec-report-${timestamp}.md`);
  const latestReportPath = join(reportsDir, 'wire-codec-report-latest.md');

  const report: WireCodecBenchReport = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    payloads,
    reportPath,
  };

  const markdown = renderWireCodecBenchMarkdown(report);
  await writeFile(reportPath, markdown, 'utf8');
  await writeFile(latestReportPath, markdown, 'utf8');

  return report;
};

export const printWireCodecBenchSummary = (report: WireCodecBenchReport): void => {
  console.log('\nWire Codec Benchmark (@dechat/core)\n');
  console.log(`Node.js: ${report.nodeVersion}`);
  console.log(`Report:  ${report.reportPath}\n`);

  for (const row of report.payloads) {
    const decodeSpeedup = speedup(row.json.deserialize.meanMs, row.cbor.deserialize.meanMs);
    const wireReduction =
      row.json.wireBytes > 0 ? ((row.json.wireBytes - row.cbor.wireBytes) / row.json.wireBytes) * 100 : 0;

    console.log(`[${row.fixture.id}]`);
    console.log(
      `  wire:       JSON ${formatBytes(row.json.wireBytes)} -> CBOR ${formatBytes(row.cbor.wireBytes)} (${formatNumber(wireReduction, 1)}% smaller)`,
    );
    console.log(
      `  deserialize: JSON ${formatNumber(row.json.deserialize.opsPerSec, 0)} ops/s | CBOR ${formatNumber(row.cbor.deserialize.opsPerSec, 0)} ops/s (${formatNumber(decodeSpeedup, 2)}× faster)`,
    );
    console.log(
      `  event-loop:  JSON p99 ${formatNumber(row.json.eventLoop.p99Ms, 4)} ms | CBOR p99 ${formatNumber(row.cbor.eventLoop.p99Ms, 4)} ms`,
    );
    console.log('');
  }
};
