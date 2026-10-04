type VoiceResult = { text?: string; audio?: Float32Array; rate?: number; done?: boolean; error?: string; progress?: string };

class LocalVoice {
  private worker?: Worker;
  private pending = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void; progress: (text: string) => void }>();
  private stream?: MediaStream;
  private context?: AudioContext;
  private recorder?: ScriptProcessorNode;
  private recordingCancel?: () => void;
  private playback: AudioBufferSourceNode[] = [];
  private playbackEnd = 0;
  private bufferedAudio: { samples: Float32Array; rate: number }[] = [];
  private playbackStarted = false;
  private epoch = 0;
  private listeningEpoch = 0;

  private request(mode: string, progress: (text: string) => void, extra: object = {}): Promise<string> {
    if (!this.worker) {
      this.worker = new Worker(new URL("./voice.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data }: MessageEvent<VoiceResult & { id: string }>) => {
        const task = this.pending.get(data.id);
        if (!task) return;
        if (data.progress) task.progress(data.progress);
        if (data.audio && data.rate) {
          this.bufferedAudio.push({ samples: data.audio, rate: data.rate });
          if (this.playbackStarted || this.bufferedAudio.length >= 2) this.flushAudio();
        }
        if (data.done) this.flushAudio();
        if (data.error || data.done || data.text !== undefined) {
          this.pending.delete(data.id);
          if (data.error) task.reject(new Error(data.error));
          else task.resolve(data.text?.trim() ?? "");
        }
      };
      this.worker.onerror = event => { this.cancel(); progress(event.message || "Voice worker failed"); };
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker!.postMessage({ id, mode, ...extra });
    });
  }

  prepare(progress: (text: string) => void) { return this.request("prepare", progress); }

  private async audioContext() {
    this.context ??= new AudioContext({ latencyHint: "interactive" });
    let timeout: number | undefined;
    try {
      await Promise.race([
        this.context.resume(),
        new Promise<never>((_resolve, reject) => { timeout = window.setTimeout(() => reject(new Error("Audio output could not start. Allow audio playback and try again.")), 10000); }),
      ]);
    } finally { window.clearTimeout(timeout); }
    return this.context;
  }

  private play(samples: Float32Array, rate: number) {
    const context = this.context!;
    const buffer = context.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const start = Math.max(context.currentTime + 0.03, this.playbackEnd);
    this.playbackEnd = start + buffer.duration;
    this.playback.push(source);
    source.onended = () => { this.playback = this.playback.filter(item => item !== source); };
    source.start(start);
  }

  private flushAudio() {
    if (!this.bufferedAudio.length) return;
    this.playbackStarted = true;
    for (const { samples, rate } of this.bufferedAudio.splice(0)) this.play(samples, rate);
  }

  async speak(text: string, progress: (text: string) => void) {
    const epoch = this.epoch;
    await this.audioContext();
    if (epoch !== this.epoch) throw new Error("Voice stopped");
    this.bufferedAudio = [];
    this.playbackStarted = false;
    await this.request("speak", progress, { text });
    const deadline = performance.now() + Math.max(0, this.playbackEnd - this.context!.currentTime) * 1000 + 10000;
    try {
      while (this.playback.length) {
        if (performance.now() > deadline) throw new Error("Audio playback stopped responding. Check your output device and try again.");
        if (this.context!.state === "suspended") await this.audioContext();
        await new Promise(resolve => window.setTimeout(resolve, 80));
      }
    } catch (error) { this.stopSpeaking(); throw error; }
    return "";
  }

  async listen(progress: (text: string) => void, level: (value: number) => void = () => {}, onSpeech?: () => void) {
    const epoch = this.epoch;
    const listeningEpoch = this.listeningEpoch;
    const context = await this.audioContext();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (epoch !== this.epoch || listeningEpoch !== this.listeningEpoch) { stream.getTracks().forEach(track => track.stop()); throw new Error("Voice stopped"); }
    this.stream = stream;
    const source = context.createMediaStreamSource(this.stream);
    const recorder = context.createScriptProcessor(4096, 1, 1);
    this.recorder = recorder;
    source.connect(recorder);
    recorder.connect(context.destination);
    progress("Listening…");
    const chunks: Float32Array[] = [];
    let heard = false, lastSpeech = performance.now(), started = performance.now();
    let speechFrames = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        this.recordingCancel = () => reject(new Error("Voice stopped"));
        recorder.onaudioprocess = event => {
          const samples = event.inputBuffer.getChannelData(0);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          level(Math.min(1, rms * 12));
          chunks.push(new Float32Array(samples));
          if (!heard && chunks.length > Math.ceil(context.sampleRate * 0.6 / 4096)) chunks.shift();
          const now = performance.now();
          if (rms > 0.018) {
            lastSpeech = now;
            if (++speechFrames >= (onSpeech ? 3 : 1) && !heard) { heard = true; onSpeech?.(); }
          } else speechFrames = 0;
          if ((heard && now - lastSpeech > 1100) || now - started > 30000) resolve();
        };
      });
    } finally {
      this.recordingCancel = undefined;
      recorder.disconnect(); source.disconnect();
      recorder.onaudioprocess = null;
      this.stream?.getTracks().forEach(track => track.stop());
      this.stream = undefined;
      this.recorder = undefined;
      level(0);
    }
    if (!heard) return "";
    const samples = new Float32Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    const resampler = new OfflineAudioContext(1, Math.ceil(samples.length * 16000 / context.sampleRate), 16000);
    const buffer = resampler.createBuffer(1, samples.length, context.sampleRate);
    buffer.copyToChannel(samples, 0);
    const playback = resampler.createBufferSource();
    playback.buffer = buffer; playback.connect(resampler.destination); playback.start();
    const rendered = await resampler.startRendering();
    if (epoch !== this.epoch || listeningEpoch !== this.listeningEpoch) throw new Error("Voice stopped");
    const resampled = rendered.getChannelData(0);
    progress("Transcribing…");
    return this.request("listen", progress, { audio: resampled });
  }

  stopListening() {
    this.listeningEpoch++;
    this.recordingCancel?.();
  }

  private stopSpeaking() {
    for (const source of this.playback) { try { source.stop(); } catch { /* Already ended. */ } }
    this.playback = [];
    this.bufferedAudio = [];
    this.playbackStarted = false;
    this.playbackEnd = 0;
    if (this.pending.size) {
      this.worker?.terminate(); this.worker = undefined;
      for (const task of this.pending.values()) task.reject(new Error("Speech interrupted"));
      this.pending.clear();
    }
  }

  async speakAndListen(text: string, progress: (text: string) => void, onSpeech: () => void) {
    let interrupted = false;
    const listening = this.listen(value => { if (interrupted) progress(value); }, () => {}, () => {
      interrupted = true;
      this.stopSpeaking();
      onSpeech();
    }).catch(() => "");
    try { await this.speak(text, progress); }
    catch (error) { if (!interrupted) { this.stopListening(); throw error; } }
    if (!interrupted) this.stopListening();
    return await listening;
  }

  cancel() {
    this.epoch++;
    this.stopListening();
    this.recorder?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stopSpeaking();
  }
}

export const Voice = new LocalVoice();
