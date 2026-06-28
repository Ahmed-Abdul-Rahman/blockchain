import { printWireCodecBenchSummary, runWireCodecBenchmark } from './wireCodec.bench';

const main = async (): Promise<void> => {
  const report = await runWireCodecBenchmark();
  printWireCodecBenchSummary(report);
};

main().catch((error: unknown) => {
  console.error('Wire codec benchmark failed:', error);
  process.exitCode = 1;
});
