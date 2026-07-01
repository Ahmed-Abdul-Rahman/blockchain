import {
  printAntiEntropySchedulerBenchSummary,
  runAntiEntropySchedulerBenchmark,
  writeAntiEntropySchedulerBenchReport,
} from './antiEntropyScheduler.bench';

const tickCount = Number(process.env.BENCH_TICK_COUNT ?? 20);

const main = (): void => {
  const report = runAntiEntropySchedulerBenchmark(tickCount);
  printAntiEntropySchedulerBenchSummary(report);
  writeAntiEntropySchedulerBenchReport(report);
};

main();
