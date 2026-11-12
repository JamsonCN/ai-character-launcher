// A single clock keeps the music position intact while the window is minimized.
class StageAudio {
  constructor() {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    this.channels = {};
    for (const channel of ['music', 'effects', 'voice', 'preview']) {
      const gain = this.context.createGain();
      gain.connect(this.master);
      this.channels[channel] = { gain, request: 0, source: null };
    }
    this.builtins = new Map();
    this.hoverNotes = new Set();
    this.hoverEpoch = 0;
    this.minimized = false;
  }

  windowChanged(minimized) {
    if (this.minimized === minimized) return;
    this.minimized = minimized;
    if (minimized) {
      this.stopHover();
      this.context.suspend().catch(console.error);
    }
    else this.context.resume().catch(console.error);
  }

  buffer(slot, file) {
    const load = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('找不到音频文件。');
      return this.context.decodeAudioData(await response.arrayBuffer());
    };
    if (file) return load(`launcher-audio://local/${file.id}`);
    if (!this.builtins.has(slot)) {
      this.builtins.set(slot, load(`launcher-audio://builtin/${slot}`).catch((error) => {
        this.builtins.delete(slot);
        throw error;
      }));
    }
    return this.builtins.get(slot);
  }

  stop(channel) {
    const lane = this.channels[channel];
    lane.request += 1;
    const source = lane.source;
    lane.source = null;
    if (source) source.stop();
  }

  async play(channel, slot, file, { loop = false, onEnd } = {}) {
    this.stop(channel);
    const lane = this.channels[channel];
    const request = lane.request;
    let buffer;
    try { buffer = await this.buffer(slot, file); } catch (error) {
      if (request !== lane.request) return;
      throw error;
    }
    if (request !== lane.request) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(lane.gain);
    lane.source = source;
    source.onended = () => {
      source.disconnect();
      if (lane.source !== source) return;
      lane.source = null;
      onEnd?.();
    };
    if (!this.minimized && this.context.state === 'suspended') this.context.resume().catch(console.error);
    source.start();
    return source;
  }

  setVolume(gain, volume) {
    gain.gain.setTargetAtTime(volume, this.context.currentTime, .014);
  }

  mix(audio) {
    this.setVolume(this.master, audio.muted ? 0 : 1);
    for (const name of ['music', 'effects', 'voice']) {
      const group = audio[name];
      const volume = group.enabled ? group.volume / 100 : 0;
      this.setVolume(this.channels[name].gain, name === 'music' && this.previewing ? 0 : volume);
    }
    if (this.previewing) this.setVolume(this.channels.preview.gain, audio[this.previewing].volume / 100);
  }

  apply(audio) {
    const previous = this.audio;
    this.audio = audio;
    this.mix(audio);
    const confirm = audio.files.confirm;
    const confirmKey = confirm?.id ?? 'builtin';
    if (confirmKey !== this.confirmKey) {
      this.stopHover();
      this.confirmKey = confirmKey;
      this.confirmBuffer = this.buffer('confirm', confirm).catch((error) => {
        console.error(error);
        return null;
      });
    }
    const track = audio.music.source === 'custom' ? audio.files.music : undefined;
    if (!audio.music.enabled) {
      this.stop('music');
      this.musicKey = undefined;
    } else if (this.musicKey !== (track?.id ?? 'builtin')) {
      this.musicKey = track?.id ?? 'builtin';
      this.play('music', 'music', track, { loop: true }).catch((error) => {
        if (this.audio === audio) this.musicKey = undefined;
        console.error(error);
      });
    }
    if (!audio.voice.enabled || (previous && previous.files !== audio.files)) this.stop('voice');
  }

  effect(slot) {
    const audio = this.audio;
    if (!audio || audio.muted || !audio.effects.enabled || this.minimized) return;
    this.play('effects', slot, audio.files[slot]).catch(console.error);
  }

  stopHover() {
    this.hoverEpoch += 1;
    for (const note of this.hoverNotes) note.stop();
    this.hoverNotes.clear();
  }

  async hover(index) {
    const audio = this.audio;
    if (!audio || audio.muted || !audio.effects.enabled || !audio.effects.volume || this.minimized) return;
    const epoch = this.hoverEpoch;
    const enteredAt = performance.now();
    const buffer = await this.confirmBuffer;
    if (!buffer || epoch !== this.hoverEpoch || audio !== this.audio || performance.now() - enteredAt > 180) return;
    if (this.hoverNotes.size >= 3) {
      const oldest = this.hoverNotes.values().next().value;
      oldest.stop();
      this.hoverNotes.delete(oldest);
    }
    const note = this.context.createBufferSource();
    const envelope = this.context.createGain();
    const offsets = [-2, -1, 0, 1, 2];
    const rate = 2 ** (offsets[index] / 12);
    const now = this.context.currentTime;
    const length = Math.min(.38, buffer.duration / rate);
    note.buffer = buffer;
    note.playbackRate.value = rate;
    note.connect(envelope).connect(this.channels.effects.gain);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(.7, now + Math.min(.008, length / 3));
    envelope.gain.setValueAtTime(.7, now + length * .82);
    envelope.gain.linearRampToValueAtTime(0, now + length);
    this.hoverNotes.add(note);
    note.onended = () => {
      this.hoverNotes.delete(note);
      note.disconnect();
      envelope.disconnect();
    };
    if (this.context.state === 'suspended') this.context.resume().catch(console.error);
    note.start(now);
    note.stop(now + length);
  }

  stopPreview(audio) {
    this.stop('preview');
    this.previewing = null;
    if (audio) this.mix(audio);
  }
}

const stageAudio = new StageAudio();
