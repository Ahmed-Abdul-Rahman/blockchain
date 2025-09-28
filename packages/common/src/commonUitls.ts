/**
 *
 * @param timeMs in ms
 */
export const wait = (timeMs: number): Promise<null> => {
  return new Promise((resolve) => setTimeout(() => resolve(null), timeMs));
};

export const pickRandom = <T>(items: T[], start?: number, end?: number): { item: T; index: number } => {
  if (items.length === 0) throw new Error('Array cannot be empty');

  const safeStart = start ?? 0;
  const safeEnd = end ?? items.length - 1;

  if (safeStart < 0 || safeEnd >= items.length || safeStart > safeEnd) throw new Error('Invalid start or end range');

  const randIndex = safeStart + Math.floor(Math.random() * (safeEnd - safeStart + 1));
  return { item: items[randIndex], index: randIndex };
};

export const sampleIndices = (size: number, limit: number): number[] => {
  if (size <= limit) return Array.from({ length: size }, (_, index) => index);
  const resultSample: number[] = [];
  const seenItems = new Set<number>();
  while (resultSample.length < limit) {
    const randomIndex = Math.floor(Math.random() * size) | 0;
    if (!seenItems.has(randomIndex)) {
      seenItems.add(randomIndex);
      resultSample.push(randomIndex);
    }
  }
  return resultSample;
};
