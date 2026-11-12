const soundSettings = field('sound-settings');
const effects = [
  ['confirm', '角色确认'],
  ['enter', '进入详情'],
  ['back', '返回选角']
];

function soundElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function soundButton(text, action, id) {
  const button = soundElement('button', text, 'small-button');
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.slot = id;
  return button;
}

function toggleLabel(text, checked, change) {
  const label = soundElement('label', '', 'sound-toggle');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => change(input.checked));
  label.append(input, text);
  return label;
}

function soundCard(group, title) {
  const card = soundElement('section', '', 'settings-card sound-card');
  card.dataset.group = group;
  const heading = soundElement('div', '', 'sound-heading');
  heading.append(soundElement('h2', title), toggleLabel('开启', draft.audio[group].enabled, (enabled) => {
    draft.audio[group].enabled = enabled;
    stageAudio.mix(draft.audio);
  }));
  heading.lastElementChild.firstElementChild.setAttribute('aria-label', '开启' + title);

  const level = soundElement('label', '', 'sound-level');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(draft.audio[group].volume);
  slider.setAttribute('aria-label', title + '音量');
  const value = soundElement('output', slider.value + '%');
  slider.addEventListener('input', () => {
    draft.audio[group].volume = Number(slider.value);
    value.textContent = slider.value + '%';
    stageAudio.mix(draft.audio);
    refreshSoundButtons();
  });
  level.append('音量', slider, value);
  card.append(heading, level);
  return card;
}

function sourceFile(slot) {
  if (slot === 'music' && draft.audio.music.source !== 'custom') return undefined;
  return draft.audio.files[slot];
}

function audioRow(slot, title, customOnly = false) {
  const row = soundElement('div', '', 'sound-row');
  const description = soundElement('div', '', 'sound-file');
  const file = draft.audio.files[slot];
  const name = file?.name ?? (customOnly ? '未配置' : state.builtinAudio[slot]);
  const filename = soundElement('span', name);
  filename.title = name;
  description.append(soundElement('strong', title), filename);
  const actions = soundElement('div', '', 'sound-actions');
  actions.append(soundButton(file ? '替换' : '导入', 'import', slot),
    soundButton('试听', 'preview', slot),
    soundButton(customOnly ? '清除' : '恢复默认', 'reset', slot));
  actions.lastElementChild.disabled = !file;
  for (const button of actions.children) button.setAttribute('aria-label', title + '：' + button.textContent);
  row.append(description, actions);
  return row;
}

function showSoundSettings() {
  const audio = draft.audio;
  const master = soundElement('div', '', 'settings-card sound-master');
  master.append(toggleLabel('总静音', audio.muted, (muted) => {
    audio.muted = muted;
    if (muted) stopSoundPreview(audio);
    else stageAudio.mix(audio);
    refreshSoundButtons();
  }));

  const music = soundCard('music', '背景音乐');
  const source = document.createElement('select');
  source.setAttribute('aria-label', '背景音乐来源');
  source.append(new Option('内置音乐', 'builtin'), new Option('自定义音乐', 'custom'));
  source.options[1].disabled = !audio.files.music;
  source.value = audio.files.music ? audio.music.source : 'builtin';
  source.addEventListener('change', () => {
    audio.music.source = source.value;
    stopSoundPreview(audio);
  });
  const sourceLabel = soundElement('label', '', 'sound-source');
  sourceLabel.append('音乐来源', source);
  music.append(sourceLabel, audioRow('music', '配乐文件'));

  const effectsCard = soundCard('effects', '界面音效');
  for (const [slot, title] of effects) effectsCard.append(audioRow(slot, title));

  const voice = soundCard('voice', '角色语音');
  const autoplay = toggleLabel('进入详情时自动播放', audio.voice.autoplay, (enabled) => {
    audio.voice.autoplay = enabled;
  });
  autoplay.firstElementChild.id = 'voice-autoplay';
  const voiceList = soundElement('div', '', 'sound-voice-list');
  for (const role of draft.roles) voiceList.append(audioRow(role.id, role.name, true));
  voice.append(autoplay, voiceList);
  soundSettings.replaceChildren(master, music, effectsCard, voice);
  refreshSoundButtons();
}

function refreshSoundButtons() {
  if (!draft) return;
  for (const button of soundSettings.querySelectorAll('[data-action="preview"]')) {
    const group = button.closest('[data-group]').dataset.group;
    const playing = stageAudio.previewSlot === button.dataset.slot;
    button.textContent = playing ? '停止' : '试听';
    button.disabled = draft.audio.muted || draft.audio[group].volume === 0 ||
      (group === 'voice' && !sourceFile(button.dataset.slot));
  }
}

function stopSoundPreview(audio) {
  stageAudio.previewSlot = null;
  stageAudio.stopPreview(audio);
  refreshSoundButtons();
}

let soundPicking = false;
soundSettings.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled || !draft || settingsBusy || soundPicking) return;
  const { action, slot } = button.dataset;
  const group = button.closest('[data-group]').dataset.group;
  const originalDraft = draft;
  const audio = draft.audio;
  const wasPlaying = stageAudio.previewSlot === slot;
  stopSoundPreview(audio);
  showMessage('');
  if (action === 'reset') {
    delete audio.files[slot];
    if (slot === 'music') audio.music.source = 'builtin';
    showSoundSettings();
  } else if (action === 'import') {
    soundPicking = true;
    saveButton.disabled = true;
    try {
      const file = await pickFile('audio');
      if (!file || draft !== originalDraft) return;
      try { await stageAudio.buffer(slot, file); } catch {
        if (draft === originalDraft) showMessage('无法读取此音频。请选择可以播放的 MP3 或 WAV 文件。');
        return;
      }
      if (draft !== originalDraft) return;
      audio.files[slot] = file;
      if (slot === 'music') audio.music.source = 'custom';
      showSoundSettings();
      showMessage('已选音频，保存后生效。', true);
    } finally {
      soundPicking = false;
      if (!settingsBusy) saveButton.disabled = false;
    }
  } else if (!wasPlaying) {
    stageAudio.previewSlot = slot;
    stageAudio.previewing = group;
    stageAudio.mix(audio);
    refreshSoundButtons();
    try {
      await stageAudio.play('preview', slot, sourceFile(slot), {
        onEnd: () => stopSoundPreview(draft?.audio ?? state.audio)
      });
    } catch {
      if (draft !== originalDraft || stageAudio.previewSlot !== slot) return;
      stopSoundPreview(audio);
      showMessage('无法播放音频，请重新选择文件。');
    }
  }
});
