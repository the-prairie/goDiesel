import type { CinematicFrame } from "@/replay/cinematic/route-cinematic-director";

export class CinematicSoundscape {
  private context?: AudioContext;
  private master?: GainNode;
  private wind?: GainNode;
  private pulse?: GainNode;
  private oscillator?: OscillatorNode;
  private noise?: AudioBufferSourceNode;

  async start() {
    if (!this.context) this.build();
    await this.context?.resume();
  }

  private build() {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const pulse = context.createGain();
    pulse.gain.value = 0.025;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = 42;
    oscillator.connect(pulse);
    pulse.connect(master);
    oscillator.start();

    const sampleCount = context.sampleRate * 4;
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    const wind = context.createGain();
    wind.gain.value = 0.035;
    noise.connect(filter);
    filter.connect(wind);
    wind.connect(master);
    noise.start();

    this.context = context;
    this.master = master;
    this.wind = wind;
    this.pulse = pulse;
    this.oscillator = oscillator;
    this.noise = noise;
  }

  update(frame: CinematicFrame, enabled: boolean) {
    if (!this.context || !this.master || !this.wind || !this.pulse) return;
    const now = this.context.currentTime;
    const intensity =
      frame.cut === "kinetic" ? 1 : frame.cut === "intimate" ? 0.62 : 0.78;
    this.master.gain.setTargetAtTime(enabled ? 0.82 : 0, now, 0.15);
    this.wind.gain.setTargetAtTime(
      (0.02 + frame.progress * 0.045) * intensity,
      now,
      0.28,
    );
    this.pulse.gain.setTargetAtTime(
      (frame.showDecision ? 0.008 : 0.018 + frame.progress * 0.022) * intensity,
      now,
      0.35,
    );
    this.oscillator?.frequency.setTargetAtTime(
      38 + frame.progress * 12,
      now,
      0.4,
    );
  }

  destroy() {
    this.noise?.stop();
    this.oscillator?.stop();
    void this.context?.close();
    this.context = undefined;
    this.master = undefined;
    this.wind = undefined;
    this.pulse = undefined;
    this.oscillator = undefined;
    this.noise = undefined;
  }
}
