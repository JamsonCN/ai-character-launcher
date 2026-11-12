const gallery = document.querySelector('#gallery');
const stage = document.querySelector('#stage');
const detail = document.querySelector('#detail');
const backButton = document.querySelector('#back');
const webButton = document.querySelector('#open-web');
const clientButton = document.querySelector('#open-client');
const clientStatus = document.querySelector('#client-status');
const clientSettings = document.querySelector('#client-settings');
const launchSettings = document.querySelector('#launch-settings');
const settingsScreen = document.querySelector('#settings');
const statement = document.querySelector('#statement');
const launchStatus = document.querySelector('#launch-status');
const voiceButton = document.querySelector('#play-voice');
const voiceStatus = document.querySelector('#voice-status');
const portrait = document.querySelector('#portrait');
const portraitBody = document.querySelector('#portrait-body');
const portraitTail = document.querySelector('#portrait-tail');
const portraitFlat = document.querySelector('#portrait-flat');
const portraitContext = portraitFlat.getContext('2d');
const claudeArm = setupClaudeArm(document.querySelector('#claude-arm'), portraitFlat);
const portraitAccessory = document.querySelector('#portrait-accessory');
const portraitLayers = [portraitBody, portraitTail, portraitFlat, portraitAccessory];

// 上下两端使用原图黑色分隔线的中心坐标，与图中斜切角度一致。
const labelRow = .85;
const percent = (x) => `${x / stageWidth * 100}%`;

let selected = null;
let selectedButton = null;
let portraitRequest = 0;
let state;
let launchSettingsSection = 'roles';
let launchPending = false;
let hoveredRole = null;

function clearStageHover() {
  hoveredRole = null;
  stageAudio.stopHover();
}

function loadLayer(element, file) {
  element.src = file;
  return element.decode();
}

async function showPortrait(character) {
  const request = ++portraitRequest;
  claudeArm.clear();
  portrait.dataset.ready = 'false';
  portrait.dataset.motion = character.imageUrl ? 'custom' : character.id;
  portraitLayers.forEach((layer) => { layer.hidden = true; });

  const { body, tail, accessory } = character.imageUrl ? {} : (character.layers ?? {});
  const layers = [
    [portraitBody, character.imageUrl || (body && `assets/${body}`)],
    [portraitTail, tail && `assets/${tail}`],
    [portraitAccessory, accessory && `assets/${accessory}`]
  ].filter(([, file]) => file);
  const [frame] = await Promise.all([
    body || character.imageUrl ? null : getPortraitFrame(character.portrait),
    ...layers.map(([element, file]) => loadLayer(element, file))
  ]);
  if (request !== portraitRequest) return;

  if (frame) {
    portraitFlat.width = frame.width;
    portraitFlat.height = frame.height;
    portraitContext.drawImage(frame, 0, 0);
    portraitFlat.hidden = false;
    if (character.id === 'claude') claudeArm.show(frame);
  }
  for (const [element] of layers) element.hidden = false;
  portrait.dataset.ready = 'true';
}

function refreshVoice(character) {
  const audio = state.audio;
  const file = audio.files[character.id];
  voiceButton.textContent = '试听语音';
  voiceButton.disabled = !file || !audio.voice.enabled || audio.muted || audio.voice.volume === 0;
  voiceStatus.textContent = !file ? '未配置' : audio.muted ? '总静音已开启' :
    !audio.voice.enabled ? '角色语音已关闭' : audio.voice.volume === 0 ? '语音音量为 0%' : '';
}

async function playRoleVoice(character) {
  if (selected !== character || detail.hidden) return;
  const audio = state.audio;
  const file = audio.files[character.id];
  if (!file || audio.muted || !audio.voice.enabled || audio.voice.volume === 0) return;
  voiceButton.textContent = '停止语音';
  voiceStatus.textContent = '';
  try {
    await stageAudio.play('voice', character.id, file, {
      onEnd: () => { if (selected === character) refreshVoice(character); }
    });
  } catch {
    if (selected !== character || detail.hidden) return;
    refreshVoice(character);
    voiceStatus.textContent = '无法播放语音，请在声音设置中重新选择文件。';
  }
}

voiceButton.addEventListener('click', () => {
  if (!selected) return;
  if (voiceButton.textContent === '停止语音') {
    stageAudio.stop('voice');
    refreshVoice(selected);
  } else playRoleVoice(selected);
});

async function selectCharacter(character, button, entered = false) {
  clearStageHover();
  stageAudio.stop('voice');
  selected = character;
  selectedButton = button;
  detail.style.setProperty('--accent', character.accent);
  document.querySelector('#character-name').textContent = character.name;
  document.querySelector('#character-description').textContent = character.character;
  portrait.setAttribute('aria-label', `${character.character}全身立绘`);
  launchStatus.textContent = '';
  launchSettings.hidden = true;
  settingsScreen.hidden = true;
  gallery.hidden = true;
  detail.hidden = false;
  backButton.focus();
  refreshVoice(character);
  if (entered) {
    stageAudio.effect('enter');
    if (state.audio.voice.autoplay) playRoleVoice(character);
  }
  await Promise.all([
    refreshClientStatus(character),
    showPortrait(character).catch(() => {
      if (selected === character) launchStatus.textContent = '暂时无法加载角色立绘。';
    })
  ]);
}

function returnToGallery() {
  if (!detail.hidden && selected) stageAudio.effect('back');
  stageAudio.stop('voice');
  portraitRequest += 1;
  claudeArm.clear();
  portrait.dataset.ready = 'false';
  detail.hidden = true;
  settingsScreen.hidden = true;
  gallery.hidden = false;
  selected = null;
  selectedButton?.focus();
}

function createStageButton(character, index) {
  const leftTop = topEdges[index];
  const rightTop = topEdges[index + 1];
  const leftBottom = bottomEdges[index];
  const rightBottom = bottomEdges[index + 1];
  const button = document.createElement('button');
  button.className = 'stage-character';
  button.type = 'button';
  button.dataset.role = character.id;
  button.dataset.stageIndex = String(index);
  button.setAttribute('aria-label', `${character.name}，${character.character}`);
  button.style.clipPath = `polygon(${percent(leftTop)} 0, ${percent(rightTop)} 0,
    ${percent(rightBottom)} 100%, ${percent(leftBottom)} 100%)`;
  button.style.setProperty('--label-x', percent(
    ((leftTop + rightTop) * (1 - labelRow) + (leftBottom + rightBottom) * labelRow) / 2
  ));
  button.style.setProperty('--accent', character.accent);

  const label = document.createElement('span');
  label.className = 'stage-label';
  label.textContent = character.name;
  button.append(label);
  button.addEventListener('click', () => selectCharacter(character, button, true));
  return button;
}

backButton.addEventListener('click', returnToGallery);
stage.addEventListener('pointermove', (event) => {
  stage.dataset.input = 'pointer';
  if (gallery.hidden || event.pointerType !== 'mouse') return;
  const card = event.target.closest('.stage-character');
  if (card === hoveredRole) return;
  hoveredRole = card;
  if (card) stageAudio.hover(Number(card.dataset.stageIndex));
});
stage.addEventListener('pointerleave', () => { hoveredRole = null; });
document.addEventListener('keydown', (event) => {
  if (statement.open) return;
  if (!settingsScreen.hidden) {
    if (event.key === 'Escape') closeSettings();
    return;
  }
  if (event.key === 'Tab' || event.key === 'Escape') stage.dataset.input = 'keyboard';
  if (event.key === 'Escape' && selected) returnToGallery();
  if (!gallery.hidden && /^[1-5]$/.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    stage.dataset.input = 'keyboard';
    stage.children[Number(event.key) - 1]?.click();
  }
});

async function refreshClientStatus(character) {
  clientButton.disabled = true;
  clientStatus.textContent = '正在检查客户端…';
  clientSettings.hidden = true;
  const status = await window.launcher.clientStatus(character.id);
  if (selected !== character) return;
  clientButton.disabled = !status.ok || launchPending;
  clientStatus.textContent = status.ok ? '' : status.message;
  clientSettings.hidden = status.ok;
}

async function launchSelected(kind) {
  if (!selected || launchPending) return;
  const character = selected;
  launchPending = true;
  webButton.disabled = true;
  clientButton.disabled = true;
  launchStatus.textContent = '';
  launchSettings.hidden = true;
  try {
    const result = await window.launcher.launch(kind, character.id);
    if (selected === character && !result.ok) {
      launchStatus.textContent = result.message;
      launchSettingsSection = result.section ?? 'roles';
      launchSettings.hidden = false;
    }
  } catch {
    if (selected === character) {
      launchStatus.textContent = '启动请求失败，请重试。';
      launchSettingsSection = kind === 'web' ? 'general' : 'roles';
      launchSettings.hidden = false;
    }
  } finally {
    launchPending = false;
    webButton.disabled = false;
    if (selected) await refreshClientStatus(selected);
  }
}

webButton.addEventListener('click', () => launchSelected('web'));
clientButton.addEventListener('click', () => launchSelected('client'));
clientSettings.addEventListener('click', () => openSettings('roles', selected?.id));
launchSettings.addEventListener('click', () => openSettings(launchSettingsSection, selected?.id));

function applyState(next) {
  state = next;
  clearStageHover();
  stageAudio.apply(next.audio);
  document.documentElement.dataset.motion = next.general.motion;
  stage.replaceChildren(...next.roles.map(createStageButton));
  stage.style.removeProperty('--stage-art');
  galleryArtwork(next.roles).then((artwork) => {
    if (state === next && artwork) stage.style.setProperty('--stage-art', `url("${artwork}")`);
  }).catch(console.error);
  document.querySelector('#app-version').textContent = `版本 ${next.version}`;
  for (const button of statement.querySelectorAll('[data-link]')) button.hidden = !next.releaseLinks[button.dataset.link];
  document.querySelector('#release-links').hidden = !Object.values(next.releaseLinks).some(Boolean);
}

document.querySelector('#show-statement').addEventListener('click', () => {
  document.querySelector('#statement-status').textContent = '';
  statement.showModal();
});
document.querySelector('#close-statement').addEventListener('click', () => statement.close());
statement.querySelectorAll('[data-link]').forEach((button) => button.addEventListener('click', async () => {
  const result = await window.launcher.openReleaseLink(button.dataset.link);
  document.querySelector('#statement-status').textContent = result.ok ? '' : result.message;
}));
document.querySelectorAll('[data-window-action]').forEach((button) => button.addEventListener('click', () => {
  window.launcher.windowAction(button.dataset.windowAction);
}));
window.launcher.onWindowChanged(({ maximized, minimized }) => {
  stageAudio.windowChanged(minimized === true);
  const button = document.querySelector('#maximize');
  button.dataset.maximized = String(maximized);
  button.title = maximized ? '还原' : '最大化';
  button.setAttribute('aria-label', button.title);
});
window.launcher.getState().then((result) => { if (result.ok) applyState(result.value); });
