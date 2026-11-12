const field = (id) => document.getElementById(id);
const settingsTabs = settingsScreen.querySelectorAll('[data-section]');
const message = field('settings-message');
const saveButton = field('save-settings');

let draft;
let editRoleId;
let returnRoleId;
let settingsBusy = false;

function showMessage(text, success = false) {
  message.textContent = text;
  message.dataset.success = String(success);
}

function showSection(section) {
  field('general-settings').hidden = section !== 'general';
  field('role-settings').hidden = section !== 'roles';
  field('sound-settings').hidden = section !== 'sound';
  if (section !== 'sound') stopSoundPreview(draft?.audio);
  for (const tab of settingsTabs) tab.setAttribute('aria-pressed', String(tab.dataset.section === section));
}

function showGeneral() {
  const general = draft.general;
  field('auto-start').checked = general.autoStart;
  field('remember-window').checked = general.rememberWindow;
  field('motion').value = general.motion;
  field('browser-path').value = general.browserPath;
  field('browser-mode').value = general.browserPath ? 'custom' : 'system';
  field('browser-picker').hidden = !general.browserPath;
  field('after-web').value = general.afterWeb;
  field('after-client').value = general.afterClient;
}

function readGeneral() {
  return {
    autoStart: field('auto-start').checked,
    rememberWindow: field('remember-window').checked,
    motion: field('motion').value,
    browserPath: field('browser-mode').value === 'custom' ? field('browser-path').value : '',
    afterWeb: field('after-web').value,
    afterClient: field('after-client').value
  };
}

function editedRole() {
  return draft.roles.find(({ id }) => id === editRoleId);
}

function readRole() {
  Object.assign(editedRole(), {
    name: field('role-name').value,
    accent: field('role-color').value,
    website: field('role-website').value,
    clientPath: field('role-client').value
  });
}

function showRoles() {
  const list = field('role-list');
  list.replaceChildren(...draft.roles.map((role, index) => {
    const button = document.createElement('button');
    const order = document.createElement('span');
    const label = document.createElement('span');
    button.type = 'button';
    button.className = 'role-choice';
    button.dataset.id = role.id;
    button.setAttribute('aria-pressed', String(editRoleId === role.id));
    order.className = 'role-order';
    order.style.setProperty('--role-color', role.accent);
    order.textContent = index + 1;
    label.textContent = role.name.trim() || '未命名角色';
    button.append(order, label);
    button.addEventListener('click', () => {
      readRole();
      editRoleId = role.id;
      showRoles();
      list.querySelector(`[data-id="${role.id}"]`).focus();
      showMessage('');
    });
    return button;
  }));
  const index = draft.roles.findIndex(({ id }) => id === editRoleId);
  field('move-up').disabled = index === 0;
  field('move-down').disabled = index === draft.roles.length - 1;
  const role = editedRole();
  field('role-name').value = role.name;
  field('role-color').value = role.accent;
  field('role-website').value = role.website;
  field('role-client').value = role.clientPath;
  field('role-image-name').textContent = role.imageUrl ? '自定义图片' : (role.image?.split(/[\\/]/).at(-1) || '默认角色图');
  field('reset-image').hidden = !role.image;
}

function openSettings(section = 'general', roleId = selected?.id) {
  if (!state || !settingsScreen.hidden) return;
  returnRoleId = selected?.id;
  draft = structuredClone(state);
  editRoleId = roleId ?? draft.roles[0].id;
  showGeneral();
  showRoles();
  showSoundSettings();
  showSection(section);
  showMessage('');
  portraitRequest += 1;
  clearStageHover();
  stageAudio.stop('voice');
  claudeArm.clear();
  portrait.dataset.ready = 'false';
  gallery.hidden = true;
  detail.hidden = true;
  settingsScreen.hidden = false;
  field('settings-heading').focus();
}

function closeSettings(saved = false) {
  if (settingsBusy) return;
  if (!saved) window.launcher.cancelSettings();
  stopSoundPreview(state.audio);
  draft = null;
  settingsScreen.hidden = true;
  if (returnRoleId) {
    const role = state.roles.find(({ id }) => id === returnRoleId);
    selectCharacter(role, stage.querySelector(`[data-role="${returnRoleId}"]`));
  } else {
    returnToGallery();
    field('show-settings').focus();
  }
}

function moveRole(offset) {
  readRole();
  const index = draft.roles.findIndex(({ id }) => id === editRoleId);
  const next = index + offset;
  if (next < 0 || next >= draft.roles.length) return;
  [draft.roles[index], draft.roles[next]] = [draft.roles[next], draft.roles[index]];
  showRoles();
}

async function pickFile(kind) {
  const result = await window.launcher.pickFile(kind);
  if (!result.ok) showMessage(result.message);
  return result.ok ? result.value : '';
}

async function testLaunch(kind, button) {
  const general = readGeneral();
  if (kind === 'web' && field('browser-mode').value === 'custom' && !general.browserPath.trim()) {
    showSection('general');
    field('browser-path').focus();
    showMessage('请选择或填写浏览器的 .exe 路径。');
    return;
  }
  button.disabled = true;
  showMessage('');
  try {
    const value = field(kind === 'web' ? 'role-website' : 'role-client').value;
    const result = await window.launcher.testLaunch(kind, value, general.browserPath);
    showMessage(result.ok ? 'Windows 已接受启动请求。' : result.message, result.ok);
  } finally {
    button.disabled = false;
  }
}

field('show-settings').addEventListener('click', () => openSettings());
for (const tab of settingsTabs) tab.addEventListener('click', () => showSection(tab.dataset.section));
field('cancel-settings').addEventListener('click', () => closeSettings());
field('move-up').addEventListener('click', () => moveRole(-1));
field('move-down').addEventListener('click', () => moveRole(1));
field('browser-mode').addEventListener('change', () => {
  field('browser-picker').hidden = field('browser-mode').value !== 'custom';
});
field('pick-browser').addEventListener('click', async () => {
  const file = await pickFile('browser');
  if (file) field('browser-path').value = file;
});
field('pick-client').addEventListener('click', async () => {
  const file = await pickFile('client');
  if (file) field('role-client').value = file;
});
field('pick-image').addEventListener('click', async () => {
  const file = await pickFile('image');
  if (!file) return;
  readRole();
  Object.assign(editedRole(), { image: file, imageUrl: '' });
  showRoles();
});
field('reset-image').addEventListener('click', () => {
  readRole();
  Object.assign(editedRole(), { image: '', imageUrl: '' });
  showRoles();
});
field('test-web').addEventListener('click', (event) => testLaunch('web', event.currentTarget));
field('test-client').addEventListener('click', (event) => testLaunch('client', event.currentTarget));

field('reset-settings').addEventListener('click', async () => {
  const result = await window.launcher.getDefaults();
  if (!result.ok) return showMessage(result.message);
  draft = result.value;
  showGeneral();
  showRoles();
  showSoundSettings();
  stopSoundPreview(draft.audio);
  showMessage('已载入默认设置，点击「保存」应用。', true);
});

saveButton.addEventListener('click', async () => {
  if (settingsBusy) return;
  const general = readGeneral();
  if (field('browser-mode').value === 'custom' && !general.browserPath.trim()) {
    showSection('general');
    field('browser-path').focus();
    showMessage('请选择或填写浏览器的 .exe 路径。');
    return;
  }
  readRole();
  settingsBusy = true;
  saveButton.disabled = true;
  showMessage('');
  try {
    const result = await window.launcher.saveSettings({ general, roles: draft.roles, audio: draft.audio });
    if (!result.ok) return showMessage(result.message);
    applyState(result.value);
    settingsBusy = false;
    closeSettings(true);
  } finally {
    settingsBusy = false;
    saveButton.disabled = false;
  }
});
