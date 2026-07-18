/**
 * Host-side wall-time check: WAN late-joiner ≤ N× LAN (default 2).
 * Does not start Docker — `run-wan-vs-lan.sh` produces the two input reports.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '@dechat/common';
import { generateTestReport, printTestReport } from '../../interop/interopTestReporter';
import { assertWanWithinLanMultiplier, loadComposeTestReport } from './dormant-room-ab';

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
};

const main = async (): Promise<void> => {
  const lanPath = process.env.COMPOSE_LAN_REPORT;
  const wanPath = process.env.COMPOSE_WAN_REPORT;
  if (!lanPath || !wanPath) {
    throw new Error('COMPOSE_LAN_REPORT and COMPOSE_WAN_REPORT are required');
  }

  const lanReport = loadComposeTestReport(lanPath);
  const wanReport = loadComposeTestReport(wanPath);

  if (!lanReport.passed) throw new Error('LAN late-joiner report did not pass');
  if (!wanReport.passed) throw new Error('WAN late-joiner report did not pass');

  const lanWallMs = lanReport.scenarioWallMs ?? 0;
  const wanWallMs = wanReport.scenarioWallMs ?? 0;
  const multiplier = Number(process.env.WAN_MAX_LAN_MULTIPLIER ?? '2');
  const skipMultiplier = parseBool(process.env.SKIP_WAN_MULTIPLIER, false);

  if (!skipMultiplier) {
    assertWanWithinLanMultiplier(lanWallMs, wanWallMs, multiplier);
  } else {
    logger.warn('[compose-wan-lan] SKIP_WAN_MULTIPLIER=true — wall-time check skipped');
  }

  const ratio = lanWallMs > 0 ? wanWallMs / lanWallMs : -1;
  const report = generateTestReport(
    'compose-wan-vs-lan',
    wanReport.totalNodes,
    Math.round((lanWallMs + wanWallMs) / 1000),
    {
      workerResults: [],
      summary: wanReport.summary,
    },
    true,
    {
      antiEntropy: wanReport.antiEntropy,
      scenarioWallMs: lanWallMs + wanWallMs,
    },
  );

  printTestReport(report);
  console.log('\n--- WAN vs LAN ---');
  console.log(`  LAN wallMs: ${lanWallMs}`);
  console.log(`  WAN wallMs: ${wanWallMs}`);
  console.log(`  Ratio: ${ratio.toFixed(2)} (limit ${multiplier}×)`);

  const reportsDir = resolve(process.cwd(), 'tests/compose-interop/reports');
  mkdirSync(reportsDir, { recursive: true });
  const out =
    process.env.COMPOSE_REPORT_PATH ??
    resolve(reportsDir, `compose-wan-vs-lan-${report.timestamp.replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      {
        ...report,
        wanVsLan: { lanWallMs, wanWallMs, multiplier, skipMultiplier, ratio },
      },
      null,
      2,
    ),
  );
  logger.info(`[compose-wan-lan] wrote ${out} (lan=${lanWallMs}ms wan=${wanWallMs}ms ratio=${ratio.toFixed(2)})`);
};

const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
};

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error('wan-vs-lan failed', error);
    process.exit(1);
  });
}
