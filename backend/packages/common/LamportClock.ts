class LamportClock {
  private clock: number;

  constructor(initialValue: number = 0) {
    this.clock = initialValue;
  }

  getTime(): number {
    return this.clock;
  }

  tick(): number {
    this.clock++;
    return this.clock;
  }

  update(receivedTime: number): number {
    this.clock = Math.max(this.clock, receivedTime) + 1;
    return this.clock;
  }
}

export default LamportClock;
