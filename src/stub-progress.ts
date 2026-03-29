import cliProgress from 'cli-progress';

export class SingleBar {
  private bar: cliProgress.SingleBar;

  constructor(opts?: any, preset?: any) {
    this.bar = new cliProgress.SingleBar(
      {
        ...opts,
        hideCursor: true,
        forceRedraw: true,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      },
      preset || cliProgress.Presets.shades_classic,
    );
  }

  start(total: number, startValue: number, payload?: any) {
    this.bar.start(total, startValue, payload);
  }

  update(value: number, payload?: any) {
    this.bar.update(value, payload);
  }

  stop() {
    this.bar.stop();
  }
}

export const Presets = cliProgress.Presets;
