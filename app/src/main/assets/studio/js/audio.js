// Audio input for the visualiser: local file, microphone, or the built-in
// mock signal. Everything is reduced to a single mono 2048-sample window that
// is handed to the WASM engine each animation frame.

const WINDOW = 2048;

export class AudioInput {
  constructor() {
    this.mode = 'none';
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this.window = new Float32Array(WINDOW);
    this.element = null;        // <audio> used for file playback
    this.fileSource = null;
    this.micSource = null;
    this.playing = false;
    this.duration = 0;
    this.mockIndex = 0;
    this.mockRate = 44100;
    this.onState = null;        // (state) => void
  }

  _ensureContext() {
    if (this.ctx) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctor();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = WINDOW;
    this.analyser.smoothingTimeConstant = 0;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 1.0;      // monitoring is on by default
    this.analyser.connect(this.gain);
    this.gain.connect(this.ctx.destination);
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 44100; }

  _emit() {
    if (this.onState) this.onState(this.state());
  }

  state() {
    return {
      mode: this.mode,
      playing: this.playing,
      duration: this.duration,
      position: this.element ? this.element.currentTime : 0,
      sampleRate: this.sampleRate,
      monitor: this.gain ? this.gain.gain.value > 0.001 : true,
    };
  }

  async resume() {
    this._ensureContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  setMonitor(on) {
    this._ensureContext();
    this.gain.gain.value = on ? 1 : 0;
    this._emit();
  }

  stop() {
    if (this.fileSource) { try { this.fileSource.disconnect(); } catch (_) {} this.fileSource = null; }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource.mediaStream.getTracks().forEach((t) => t.stop());
      this.micSource = null;
    }
    if (this.element) { this.element.pause(); }
    this.mode = 'none';
    this.playing = false;
    this._emit();
  }

  // --- file ---------------------------------------------------------------
  async loadFile(file) {
    await this.resume();
    this.stop();
    if (!this.element) {
      this.element = new Audio();
      this.element.crossOrigin = 'anonymous';
      this.element.addEventListener('ended', () => { this.playing = false; this._emit(); });
      this.element.addEventListener('timeupdate', () => this._emit());
      this.element.addEventListener('loadedmetadata', () => {
        this.duration = this.element.duration || 0;
        this._emit();
      });
    }
    if (!this.fileSource) {
      this.fileSource = this.ctx.createMediaElementSource(this.element);
      this.fileSource.connect(this.analyser);
    }
    this.element.src = URL.createObjectURL(file);
    this.mode = 'file';
    await this.element.play();
    this.playing = true;
    this._emit();
    return this.element;
  }

  async playPause() {
    if (this.mode !== 'file' || !this.element) return;
    if (this.element.paused) { await this.element.play(); this.playing = true; }
    else { this.element.pause(); this.playing = false; }
    this._emit();
  }

  async seek(seconds) {
    if (this.element) this.element.currentTime = seconds;
  }

  // --- microphone ---------------------------------------------------------
  async useMic() {
    await this.resume();
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micSource = this.ctx.createMediaStreamSource(stream);
    this.micSource.connect(this.analyser);
    this.mode = 'mic';
    this.playing = true;
    this._emit();
  }

  // --- mock signal --------------------------------------------------------
  useMock() {
    this.stop();
    this.mode = 'mock';
    this.playing = true;
    this.duration = 214;   // pretend track length for the clock/progress vars
    this._emit();
  }

  toggleMock() {
    if (this.mode === 'mock') { this.mode = 'none'; this.playing = false; this._emit(); }
    else this.useMock();
  }

  /** One mono analysis window, ready for the engine. */
  read() {
    if (this.mode === 'file' || this.mode === 'mic') {
      if (this.analyser) this.analyser.getFloatTimeDomainData(this.window);
      return this.window;
    }
    if (this.mode === 'mock') {
      const n = WINDOW;
      const sr = this.mockRate;
      for (let i = 0; i < n; i++) this.window[i] = mockSample(this.mockIndex + i, sr);
      this.mockIndex += n;
      return this.window;
    }
    this.window.fill(0);
    return this.window;
  }

  /** Position/duration used for {position}/{duration}/{remaining}. */
  position() {
    if (this.mode === 'file' && this.element) return this.element.currentTime;
    if (this.mode === 'mock') return (this.mockIndex / this.mockRate) % (this.duration || 1);
    return 0;
  }
}

// A deterministic 124 BPM groove so the editor is usable without any audio
// file: kick, sub, chord stabs and offbeat hats.
function mockSample(i, sr) {
  const t = i / sr;
  const twoPi = 2 * Math.PI;
  const beat = (t * 2.0666) % 1;                       // ~124 BPM
  const kickEnv = Math.max(0, 1 - beat * 6);
  const sweep = 140 * Math.exp(-beat * 12) + 48;
  let s = 0.85 * Math.sin(twoPi * sweep * t) * kickEnv;
  s += 0.20 * Math.sin(twoPi * 110 * t) * (0.5 + 0.5 * Math.sin(twoPi * 0.25 * t));
  s += 0.13 * Math.sin(twoPi * 220 * t + 2 * Math.sin(twoPi * 3.1 * t));
  s += 0.09 * Math.sin(twoPi * 660 * t + 3 * Math.sin(twoPi * 1.7 * t));
  const off = (t * 2.0666 + 0.5) % 1;
  const nz = (((i * 2654435761) >>> 0) % 2000) / 1000 - 1;
  s += 0.06 * nz * Math.max(0, 1 - off * 9);
  return Math.max(-1, Math.min(1, s));
}
