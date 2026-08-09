import type { CinematicFrame } from "@/surfaces/replay/cinematic/route-cinematic-director";

export interface CinematicSoundMix {
  airGain: number;
  pan: number;
  pulseGain: number;
  rootHz: number;
  scoreGain: number;
  windGain: number;
}

export function cinematicSoundMix(frame: CinematicFrame): CinematicSoundMix {
  const cutIntensity =
    frame.cut === "kinetic" ? 1 : frame.cut === "intimate" ? 0.62 : 0.82;
  const rootHz = {
    establishing: 55,
    reveal: 65.41,
    tracking: 73.42,
    summit: 82.41,
    release: 61.74,
  }[frame.shotKind];
  return {
    airGain: (0.006 + frame.motionIntensity * 0.018) * cutIntensity,
    pan: Math.max(
      -0.6,
      Math.min(0.6, Math.sin((frame.headingDeg * Math.PI) / 180) * 0.6),
    ),
    pulseGain:
      (frame.showDecision
        ? 0.005
        : 0.012 + frame.motionIntensity * 0.026) * cutIntensity,
    rootHz,
    scoreGain:
      (frame.showDecision ? 0.003 : 0.006 + frame.shotIndex * 0.004) *
      cutIntensity,
    windGain:
      (0.014 + frame.motionIntensity * 0.052 + frame.progress * 0.012) *
      cutIntensity,
  };
}

export class CinematicSoundscape {
  private context?: AudioContext;
  private master?: GainNode;
  private wind?: GainNode;
  private air?: GainNode;
  private windPanner?: StereoPannerNode;
  private pulse?: GainNode;
  private score?: GainNode;
  private oscillator?: OscillatorNode;
  private scoreOscillator?: OscillatorNode;
  private harmonyOscillator?: OscillatorNode;
  private noise?: AudioBufferSourceNode;
  private chapter?: string;

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

    const score = context.createGain();
    score.gain.value = 0.012;
    const scoreOscillator = context.createOscillator();
    scoreOscillator.type = "triangle";
    scoreOscillator.frequency.value = 82.41;
    const scoreFilter = context.createBiquadFilter();
    scoreFilter.type = "lowpass";
    scoreFilter.frequency.value = 240;
    scoreOscillator.connect(scoreFilter);
    scoreFilter.connect(score);
    score.connect(master);
    scoreOscillator.start();

    const harmony = context.createGain();
    harmony.gain.value = 0.004;
    const harmonyOscillator = context.createOscillator();
    harmonyOscillator.type = "sine";
    harmonyOscillator.frequency.value = 123.62;
    const harmonyFilter = context.createBiquadFilter();
    harmonyFilter.type = "lowpass";
    harmonyFilter.frequency.value = 320;
    harmonyOscillator.connect(harmonyFilter);
    harmonyFilter.connect(harmony);
    harmony.connect(master);
    harmonyOscillator.start();

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
    const windPanner = context.createStereoPanner();
    noise.connect(filter);
    filter.connect(wind);
    wind.connect(windPanner);
    windPanner.connect(master);

    const airFilter = context.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 2_400;
    airFilter.Q.value = 0.55;
    const air = context.createGain();
    air.gain.value = 0.01;
    noise.connect(airFilter);
    airFilter.connect(air);
    air.connect(master);
    noise.start();

    this.context = context;
    this.master = master;
    this.wind = wind;
    this.air = air;
    this.windPanner = windPanner;
    this.pulse = pulse;
    this.score = score;
    this.oscillator = oscillator;
    this.scoreOscillator = scoreOscillator;
    this.harmonyOscillator = harmonyOscillator;
    this.noise = noise;
  }

  update(frame: CinematicFrame, enabled: boolean) {
    if (
      !this.context ||
      !this.master ||
      !this.wind ||
      !this.air ||
      !this.pulse ||
      !this.score
    ) {
      return;
    }
    const now = this.context.currentTime;
    const mix = cinematicSoundMix(frame);
    this.master.gain.setTargetAtTime(enabled ? 0.82 : 0, now, 0.15);
    this.wind.gain.setTargetAtTime(mix.windGain, now, 0.28);
    this.air.gain.setTargetAtTime(mix.airGain, now, 0.4);
    this.windPanner?.pan.setTargetAtTime(mix.pan, now, 0.55);
    this.pulse.gain.setTargetAtTime(mix.pulseGain, now, 0.35);
    this.oscillator?.frequency.setTargetAtTime(
      38 + frame.progress * 12,
      now,
      0.4,
    );
    this.score.gain.setTargetAtTime(mix.scoreGain, now, 0.8);
    this.scoreOscillator?.frequency.setTargetAtTime(
      mix.rootHz,
      now,
      1.4,
    );
    this.harmonyOscillator?.frequency.setTargetAtTime(
      mix.rootHz * 1.5,
      now,
      1.7,
    );
    if (enabled && this.chapter !== frame.chapter && frame.elapsedSeconds > 0) {
      this.chapter = frame.chapter;
      this.punctuateChapter(now);
    }
  }

  private punctuateChapter(now: number) {
    if (!this.context || !this.master) return;
    const impact = this.context.createOscillator();
    const envelope = this.context.createGain();
    impact.type = "sine";
    impact.frequency.setValueAtTime(54, now);
    impact.frequency.exponentialRampToValueAtTime(34, now + 0.7);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.09, now + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    impact.connect(envelope);
    envelope.connect(this.master);
    impact.start(now);
    impact.stop(now + 0.95);
  }

  destroy() {
    this.noise?.stop();
    this.oscillator?.stop();
    this.scoreOscillator?.stop();
    this.harmonyOscillator?.stop();
    void this.context?.close();
    this.context = undefined;
    this.master = undefined;
    this.wind = undefined;
    this.air = undefined;
    this.windPanner = undefined;
    this.pulse = undefined;
    this.score = undefined;
    this.oscillator = undefined;
    this.scoreOscillator = undefined;
    this.harmonyOscillator = undefined;
    this.noise = undefined;
    this.chapter = undefined;
  }
}
