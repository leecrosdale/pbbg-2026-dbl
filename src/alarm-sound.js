// Synthesised locally: no audio downloads or external services are needed.
export class AlarmSound {
  context = null;
  enabled = false;
  sources = new Set();
  ringing = false;
  previewTimer = null;

  async enable() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Audio is unavailable in this browser.');
    this.context ||= new AudioContext();
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio could not start. Please try again.');
    this.enabled = true;
    // A short preview confirms that sound is working.
    this.start();
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      if (!this.ringing) this.stop();
    }, 1200);
  }

  disable() {
    this.enabled = false;
    this.stop();
  }

  update(ringing) {
    this.ringing = ringing;
    if (!this.enabled) { this.stop(); return; }
    if (ringing) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
      if (this.context?.state === 'running' && !this.sources.size) this.start();
    } else if (!this.previewTimer) this.stop();
  }

  start() {
    if (this.sources.size) return;
    const context = this.context;
    const oscillator = context.createOscillator();
    const modulation = context.createOscillator();
    const sweep = context.createGain();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    // A continuous air-raid-style wail, sweeping 300–1100 Hz every 2.5 seconds.
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 700;
    modulation.type = 'triangle';
    modulation.frequency.value = 0.4;
    sweep.gain.value = 400;
    modulation.connect(sweep);
    sweep.connect(oscillator.frequency);
    filter.type = 'lowpass';
    filter.frequency.value = 1700;
    filter.Q.value = 0.5;
    envelope.gain.setValueAtTime(0, context.currentTime);
    envelope.gain.linearRampToValueAtTime(0.065, context.currentTime + 0.1);
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(context.destination);
    this.sources.add(oscillator);
    this.sources.add(modulation);
    oscillator.onended = () => {
      this.sources.delete(oscillator);
      this.sources.delete(modulation);
      oscillator.disconnect();
      modulation.disconnect();
      sweep.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
    oscillator.start();
    modulation.start();
  }

  stop() {
    clearTimeout(this.previewTimer);
    this.previewTimer = null;
    for (const source of this.sources) source.stop();
    this.sources.clear();
  }
}
