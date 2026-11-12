const fs = require('node:fs');
const path = require('node:path');

const rate = 44100;
const tau = 2 * Math.PI;
const directory = path.join(__dirname, '..', 'src', 'assets', 'audio');
fs.mkdirSync(directory, { recursive: true });

function piece(seconds) {
  return [new Float64Array(rate * seconds), new Float64Array(rate * seconds)];
}

function tone(channels, { at, duration, note, level, pan = 0, bell = false }) {
  const offset = Math.round(at * rate);
  const length = Math.round(duration * rate);
  const frequency = 440 * 2 ** ((note - 69) / 12);
  const attack = bell ? .018 : .82;
  const release = bell ? .3 : 1.38;
  const left = Math.sqrt((1 - pan) / 2);
  const right = Math.sqrt((1 + pan) / 2);
  for (let i = 0; i < length; i++) {
    const time = i / rate;
    const fade = (x) => .5 - .5 * Math.cos(Math.PI * Math.min(1, x));
    const envelope = fade(time / attack) * fade((duration - time) / release);
    const angle = tau * frequency * time;
    const sample = bell
      ? (Math.sin(angle) + .19 * Math.sin(2.01 * angle) * Math.exp(-3 * time) +
        .055 * Math.sin(3.96 * angle) * Math.exp(-6 * time)) * Math.exp(-1.85 * time)
      : Math.sin(angle) + .14 * Math.sin(2 * angle) + .08 * Math.sin(angle * 1.002);
    // Wrap the decay of the last phrase into the first, so the loop has no cut.
    const index = (offset + i) % channels[0].length;
    channels[0][index] += level * left * sample * envelope;
    channels[1][index] += level * right * sample * envelope;
  }
}

function writeWave(name, [left, right], peakTarget) {
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peakTarget / peak;
  const wav = Buffer.alloc(44 + left.length * 4);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < left.length; i++) {
    wav.writeInt16LE(Math.round(left[i] * gain * 32767), 44 + 4 * i);
    wav.writeInt16LE(Math.round(right[i] * gain * 32767), 46 + 4 * i);
  }
  fs.writeFileSync(path.join(directory, name + '.wav'), wav);
}

// 幻彩序曲 · 八小节，32 秒。低音与柔和的和弦衔接，铃音只在乐句留白处出现。
const chords = [
  [50, 57, 61, 64, 66], [47, 54, 57, 62, 66], [43, 55, 57, 62, 66], [45, 52, 57, 59, 64],
  [50, 57, 61, 64, 69], [47, 54, 57, 62, 66], [43, 50, 55, 59, 66], [45, 52, 57, 61, 64]
];
const motifs = [
  [69, 73, 76, 73], [66, 71, 74], [67, 69, 74, 78], [76, 71, 69],
  [69, 73, 76, 81], [78, 74, 71], [67, 74, 78, 74], [76, 73, 69]
];
const music = piece(32);
chords.forEach((chord, bar) => {
  chord.forEach((note, part) => tone(music, {
    at: bar * 4 + part * .07, duration: 5.3, note, level: part ? .071 : .12, pan: (part - 2) * .15
  }));
  motifs[bar].forEach((note, beat) => {
    const at = bar * 4 + [.46, 1.27, 2.01, 2.9][beat];
    tone(music, { at, duration: 1.85, note, level: .115, pan: beat % 2 ? .24 : -.24, bell: true });
    tone(music, { at: at + .38, duration: 1.6, note, level: .026, pan: beat % 2 ? -.45 : .45, bell: true });
  });
});
writeWave('music', music, .47);

for (const [name, notes, gap] of [
  ['confirm', [76], .06], ['enter', [69, 74, 78], .074], ['back', [74, 69], .079]
]) {
  const sound = piece(.56);
  notes.forEach((note, index) => tone(sound, {
    at: index * gap, duration: .37, note, level: .5 ** index, pan: index * .12, bell: true
  }));
  writeWave(name, sound, .30);
}
