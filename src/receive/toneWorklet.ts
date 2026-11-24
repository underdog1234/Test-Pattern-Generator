// The microphone side runs on the audio thread, in an AudioWorklet, so it hears
// the beep in steps of 128 samples (about 2.7 ms) no matter what the page is doing.
//
// This function is self-contained on purpose: its source text is what gets
// loaded into the worklet, so it may only use the globals the worklet provides
// (AudioWorkletProcessor, registerProcessor, sampleRate, currentTime).

export const TONE_WORKLET_NAME = "tone-meter";

/** The window the tone is measured over, in samples (256 = 5.3 ms at 48 kHz). */
export const TONE_WINDOW = 256;

export function toneWorkletBody() {
  class ToneMeter extends (globalThis as any).AudioWorkletProcessor {
    freq: number;
    win: number;
    ring: Float32Array;
    pos: number;
    count: number;
    coeff: number;
    constructor(options: any) {
      super();
      const o = (options && options.processorOptions) || {};
      this.freq = o.freq || 1000;
      this.win = o.windowSamples || 256;
      this.ring = new Float32Array(this.win);
      this.pos = 0;
      this.count = 0;
      this.coeff = 2 * Math.cos((2 * Math.PI * this.freq) / (globalThis as any).sampleRate);
    }
    process(inputs: Float32Array[][]) {
      const ch = inputs[0] && inputs[0][0];
      if (!ch) return true;
      const rate = (globalThis as any).sampleRate as number;
      const n = ch.length;
      let sumSq = 0;
      for (let i = 0; i < n; i += 1) {
        this.ring[this.pos] = ch[i];
        this.pos = (this.pos + 1) % this.win;
        sumSq += ch[i] * ch[i];
      }
      this.count = Math.min(this.win, this.count + n);
      if (this.count < this.win) return true;
      // Goertzel over the window, oldest sample first.
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < this.win; i += 1) {
        const s = this.ring[(this.pos + i) % this.win] + this.coeff * s1 - s2;
        s2 = s1;
        s1 = s;
      }
      const power = s1 * s1 + s2 * s2 - this.coeff * s1 * s2;
      const mag = (2 * Math.sqrt(Math.max(0, power))) / this.win;
      // The window ends where this block ends.
      const end = (globalThis as any).currentTime + n / rate;
      (this as any).port.postMessage({ end, mag, rms: Math.sqrt(sumSq / n) });
      return true;
    }
  }
  (globalThis as any).registerProcessor("tone-meter", ToneMeter);
}

/** A URL the AudioContext can load the worklet from. */
export const toneWorkletUrl = (): string => URL.createObjectURL(new Blob([`(${toneWorkletBody.toString()})()`], { type: "text/javascript" }));
