import {
  boundCustomProfileIds,
  canAccessCustomStudio,
  canPersistCustomProfile,
  canUseCatalogSkin,
  hasEntitlementPermission,
} from './entitlement-ui.js';

const state = {
  token: '',
  selectedClient: 'codex',
  catalogByClient: Object.create(null),
  status: null,
  catalog: [],
  profiles: [],
  products: null,
  entitlement: {tier: 'free', permissions: {}},
  schedule: null,
  filter: 'all',
  pendingIntent: null,
  shownReminderKey: null,
  customImage: null,
  customComposerAvatar: null,
  freeBrand: null,
  freeComposerAvatar: null,
};

const clientNames = {codex: 'Codex', workbuddy: 'WorkBuddy', doubao: '豆包'};
const clientOrder = ['codex', 'workbuddy', 'doubao'];
const dayLabels = {
  monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四',
  friday: '周五', saturday: '周六', sunday: '周日',
};
const gradientClass = new Set(['aurora', 'graphite', 'jade', 'ocean', 'sunset', 'violet']);

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

function tokenFromHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('token') || sessionStorage.getItem('skin-studio-token') || '';
  if (token) sessionStorage.setItem('skin-studio-token', token);
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
  return token;
}

async function api(path, {method = 'GET', body} = {}) {
  const headers = {Authorization: `Bearer ${state.token}`};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {ok: false, error: `HTTP ${response.status}`}; }
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `请求失败 (${response.status})`);
    error.code = payload.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 4200);
}

function setBusy(button, busy, label = '处理中…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
  }
}

function showView(view) {
  $$('.view').forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  $$('.nav-item').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function selectedClientRecord() {
  return state.status?.clients?.[state.selectedClient] || null;
}

function orderedClients() {
  const known = Object.keys(state.status?.clients || {});
  return clientOrder.filter((clientId) => known.includes(clientId) && clientNames[clientId]);
}

function clientGlyph(clientId) {
  if (clientId === 'codex') return 'C';
  if (clientId === 'workbuddy') return 'W';
  if (clientId === 'doubao') return 'D';
  return (clientId || '?').slice(0, 1).toUpperCase();
}

function skinById(id) {
  return state.catalog.find((skin) => skin.id === id) ||
    state.profiles.find((profile) => profile.id === id) || null;
}

function isVip() {
  return hasEntitlementPermission(state.entitlement, 'allFeatures');
}

function localTrialCopy(trial) {
  if (!trial || trial.kind !== 'local-first-use') return null;
  const expiry = trial.expiresAt ? new Date(trial.expiresAt).toLocaleString('zh-CN') : null;
  if (trial.state !== 'active') return expiry ? `7 天免费 VIP 试用已于 ${expiry} 结束。` : '7 天免费 VIP 试用已结束。';
  const seconds = Math.max(0, Number(trial.remainingSeconds) || 0);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.max(1, Math.floor((seconds % 3_600) / 60));
  const remaining = days > 0 ? `${days} 天 ${hours} 小时` :
    hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
  return `本机首次使用免费 VIP · 剩余 ${remaining}${expiry ? ` · 到期 ${expiry}` : ''}`;
}

function compatibilityLabel(record) {
  if (!record?.installed) return '未安装';
  if (record.compatibility?.level === 'exact') return '精确适配';
  if (record.compatibility?.level === 'generic-safe') return '基础适配';
  return '暂不可用';
}

function renderStatus() {
  if (!state.status) return;
  for (const clientId of orderedClients()) {
    const record = state.status.clients?.[clientId];
    const label = $(`#${clientId}-install-state`);
    if (label) label.textContent = record?.installed
      ? `${record.version || '未知版本'} · ${compatibilityLabel(record)}`
      : '未安装';
    $(`#client-${clientId}`)?.classList.toggle('active', state.selectedClient === clientId);
  }
  const record = selectedClientRecord();
  const statusPill = $('#refresh-status');
  const ready = record?.compatibility?.advancedAllowed;
  statusPill.dataset.state = ready ? 'ready' : 'blocked';
  $('#status-label').textContent = ready ? compatibilityLabel(record) : (record?.installed ? '安全检查未通过' : '未安装');
  $('#hero-client-name').textContent = clientNames[state.selectedClient];
  $('#free-workbuddy-card').hidden = state.selectedClient !== 'workbuddy';

  const session = record?.session;
  const activeSkin = session?.profileId ? skinById(session.profileId) : null;
  $('#current-skin-name').textContent = activeSkin?.name || (session?.profileId || '官方原版');
  $('#current-skin-detail').textContent = session?.mode
    ? `灵妆正通过安全 ${session.mode === 'pipe' ? 'Pipe' : session.mode} 通道管理本次会话`
    : '尚未由灵妆启动皮肤模式';
  $('#restore-current').disabled = !session?.mode;
  const hasPermanent = (state.entitlement.skinIds?.length ?? 0) > 0 ||
    (state.entitlement.customProfileIds?.length ?? 0) > 0;
  $('#account-avatar').textContent = isVip() ? 'V' : hasPermanent ? '购' : '免';
  renderDiagnostics();
  renderLoginAgent();
  updateScheduleSummary();
  maybeShowReminder();
}

function renderLoginAgent() {
  const status = state.status?.loginAgent;
  const badge = $('#login-agent-state');
  const button = $('#toggle-login-agent');
  const detail = $('#login-agent-detail');
  if (!badge || !button || !detail) return;
  const enabled = status?.managed === true;
  const conflict = status?.installed === true && !enabled;
  const unavailable = status?.state === 'unavailable' || status?.state === 'unsafe';
  badge.textContent = enabled ? '已开启' : conflict ? '需要检查' : unavailable ? '当前不可用' : '默认关闭';
  badge.className = `status-badge${enabled ? ' ready' : conflict || unavailable ? ' blocked' : ''}`;
  button.textContent = enabled ? '关闭' : '开启（VIP）';
  button.disabled = conflict || unavailable;
  detail.textContent = enabled
    ? '已安全写入本机登录项；下次登录后在后台检查当天排程。每次换肤仍会先询问。'
    : conflict
      ? '检测到非灵妆管理的同名登录项。为了安全，不会覆盖或删除。'
      : unavailable
        ? '本机登录项目录或启动文件未通过安全检查，因此没有进行任何修改。'
        : '默认关闭。开启后，下次登录会在后台检查当天排程；发现目标应用正在使用时先询问，不会静默重启。';
}

async function switchClient(clientId) {
  if (!clientNames[clientId] || clientId === state.selectedClient) return;
  state.selectedClient = clientId;
  if (state.catalogByClient[clientId]) {
    state.catalog = state.catalogByClient[clientId];
  } else {
    state.catalog = [];
    renderCatalog();
    const catalog = await api(`/api/catalog?clientId=${encodeURIComponent(clientId)}`);
    state.catalogByClient[clientId] = catalog.skins;
    if (state.selectedClient === clientId) state.catalog = state.catalogByClient[clientId];
  }
  renderStatus();
  renderCatalog();
  renderWeek();
}

function skinCard(skin) {
  const article = document.createElement('article');
  article.className = 'skin-card';
  const preview = document.createElement('div');
  const preset = gradientClass.has(skin.preview?.gradientPreset) ? skin.preview.gradientPreset : 'graphite';
  preview.className = `skin-preview ${preset}`;
  const body = document.createElement('div');
  body.className = 'skin-card-body';
  const heading = document.createElement('div');
  heading.className = 'skin-card-heading';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = skin.name;
  const description = document.createElement('p');
  description.textContent = skin.description || '保存在本机的自定义皮肤';
  titleWrap.append(title, description);
  const tier = document.createElement('span');
  tier.className = `tier-tag ${skin.tier === 'vip' ? 'vip' : 'free'}`;
  tier.textContent = skin.tier === 'vip' ? 'VIP' : 'FREE';
  heading.append(titleWrap, tier);

  const actions = document.createElement('div');
  actions.className = 'skin-actions';
  const compat = document.createElement('div');
  compat.className = 'compat-chips';
  for (const clientId of skin.clientIds || orderedClients()) {
    const chip = document.createElement('span');
    chip.textContent = clientGlyph(clientId);
    chip.title = clientNames[clientId];
    compat.append(chip);
  }
  const button = document.createElement('button');
  const locked = !canUseCatalogSkin(state.entitlement, skin);
  const permanentlyUnlocked = skin.tier === 'vip' &&
    !isVip() && state.entitlement.skinIds?.includes(skin.id);
  button.className = locked ? 'secondary-button compact' : 'primary-button';
  button.type = 'button';
  button.textContent = locked ? '预览 · 需授权' : permanentlyUnlocked ? '应用 · 已永久解锁' : '应用皮肤';
  button.addEventListener('click', () => {
    if (locked) {
      toast('这套皮肤可以预览；应用需要有效 VIP 或这套皮肤的永久授权', 'info');
      showView('vip');
      return;
    }
    requestApply(skin.id, skin.name).catch(showError);
  });
  actions.append(compat, button);
  body.append(heading, actions);
  article.append(preview, body);
  return article;
}

function renderCatalog() {
  const supported = state.catalog.filter((skin) => skin.clientIds?.includes(state.selectedClient));
  const filtered = state.filter === 'all' ? supported : supported.filter((skin) => skin.tier === state.filter);
  const library = $('#library-skins');
  library.replaceChildren(...filtered.map(skinCard));
  $('#library-count').textContent = `${filtered.length} 套适用于 ${clientNames[state.selectedClient]} 的皮肤`;
  const featured = $('#featured-skins');
  featured.replaceChildren(...supported.slice(0, 3).map(skinCard));
}

function openApplyDialog(intent, skinName) {
  state.pendingIntent = intent;
  const restore = intent.summary.operation === 'restore';
  $('#apply-dialog-icon').textContent = restore ? '↺' : '↻';
  $('#apply-dialog-title').textContent = restore ? '恢复原版并重启？' : '切换皮肤并重启？';
  $('#apply-dialog-copy').textContent = restore
    ? '目标应用会正常退出，再以无调试参数的官方模式重新打开。请先保存尚未提交的内容。'
    : '目标应用会正常退出，再以安全 Pipe 模式重新打开。请先保存尚未提交的内容。';
  $('#apply-impact-client').textContent = clientNames[intent.summary.clientId];
  $('#apply-impact-skin').textContent = restore ? '官方原版' : skinName;
  $('#confirm-apply').textContent = restore ? '确认恢复并重启' : '确认切换并重启';
  $('#apply-dialog').showModal();
}

async function requestApply(skinId, skinName) {
  const payload = await api('/api/apply-intents', {
    method: 'POST', body: {clientId: state.selectedClient, skinId, operation: 'apply'},
  });
  openApplyDialog(payload.intent, skinName);
}

async function requestRestore() {
  const payload = await api('/api/apply-intents', {
    method: 'POST', body: {clientId: state.selectedClient, operation: 'restore'},
  });
  openApplyDialog(payload.intent, '官方原版');
}

async function confirmIntent(event) {
  event.preventDefault();
  if (!state.pendingIntent) return;
  const button = $('#confirm-apply');
  setBusy(button, true, '正在安全切换…');
  try {
    const intent = state.pendingIntent;
    await api(`/api/apply-intents/${encodeURIComponent(intent.id)}/confirm`, {
      method: 'POST', body: {clientId: intent.summary.clientId},
    });
    $('#apply-dialog').close('confirmed');
    state.pendingIntent = null;
    toast(intent.summary.operation === 'restore' ? '已恢复官方界面' : '皮肤已应用', 'success');
    await refreshStatus(true);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(button, false);
  }
}

function scheduleOption(skin, selected) {
  const option = document.createElement('option');
  option.value = skin.id;
  option.textContent = `${skin.name}${skin.tier === 'vip' ? ' · VIP' : ''}`;
  option.selected = selected === skin.id;
  return option;
}

function todayName() {
  const timeZone = state.schedule?.timeZone;
  try {
    return new Intl.DateTimeFormat('en-US', {weekday: 'long', timeZone}).format(new Date()).toLowerCase();
  } catch {
    return new Intl.DateTimeFormat('en-US', {weekday: 'long'}).format(new Date()).toLowerCase();
  }
}

function renderWeek() {
  if (!state.schedule) return;
  const grid = $('#week-grid');
  const week = state.schedule.clients[state.selectedClient];
  const available = state.catalog.filter((skin) => skin.clientIds?.includes(state.selectedClient));
  const today = todayName();
  const cards = Object.entries(dayLabels).map(([day, label]) => {
    const card = document.createElement('article');
    card.className = `day-card${today === day ? ' today' : ''}`;
    const heading = document.createElement('span');
    heading.textContent = label;
    const selected = week[day];
    const skin = available.find((item) => item.id === selected);
    const preview = document.createElement('div');
    const preset = skin?.preview?.gradientPreset || 'graphite';
    preview.className = `day-preview skin-preview ${gradientClass.has(preset) ? preset : 'graphite'}`;
    const select = document.createElement('select');
    select.dataset.day = day;
    select.setAttribute('aria-label', `${label}皮肤`);
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '当天不安排';
    select.append(empty, ...available.map((item) => scheduleOption(item, selected)));
    select.value = selected || '';
    select.addEventListener('change', () => {
      state.schedule.clients[state.selectedClient][day] = select.value || null;
      renderWeek();
    });
    card.append(heading, preview, select);
    return card;
  });
  grid.replaceChildren(...cards);
  $('#schedule-enabled').checked = state.schedule.enabled;
  $('#schedule-timezone').value = state.schedule.timeZone === 'Asia/Shanghai' ? 'Asia/Shanghai' : 'local';
  $('#schedule-lock').hidden = hasEntitlementPermission(state.entitlement, 'weeklySchedule');
  renderCustomEntitlement();
}

function updateScheduleSummary() {
  if (!state.schedule) return;
  const day = todayName();
  const skinId = state.schedule.clients?.[state.selectedClient]?.[day];
  const skin = skinById(skinId);
  $('#today-schedule-title').textContent = skin ? `今天：${skin.name}` : '还没有安排今天';
  $('#today-schedule-copy').textContent = skin
    ? `当天首次使用 ${clientNames[state.selectedClient]} 时会询问是否重启切换。`
    : `可以为 ${orderedClients().map((id) => clientNames[id]).join(' / ')} 分别设置周一到周日的皮肤。`;
}

async function saveSchedule() {
  if (!hasEntitlementPermission(state.entitlement, 'weeklySchedule')) {
    showView('vip'); toast('七日排程需要有效 VIP', 'info'); return;
  }
  state.schedule.enabled = $('#schedule-enabled').checked;
  const zone = $('#schedule-timezone').value;
  state.schedule.timeZone = zone === 'local'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : zone;
  const button = $('#save-schedule');
  setBusy(button, true, '正在保存…');
  try {
    const payload = await api('/api/schedule', {method: 'POST', body: {schedule: state.schedule}});
    state.schedule = payload.schedule;
    toast('一周计划已保存', 'success');
    updateScheduleSummary();
  } finally { setBusy(button, false); }
}

function customProfile() {
  const name = $('#custom-name').value.trim() || '我的专属皮肤';
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36);
  const boundProfileId = $('#custom-profile-slot').value;
  return {
    schemaVersion: 1,
    id: boundProfileId || slug || `custom-${Date.now().toString(36)}`,
    name,
    official: {
      variant: $('#custom-theme-mode').value, codeThemeId: 'codex',
      accent: $('#custom-accent').value.toUpperCase(),
      surface: $('#custom-surface').value.toUpperCase(),
      ink: $('#custom-ink').value.toUpperCase(),
      contrast: 50, fonts: {code: null, ui: null}, opaqueWindows: false,
      semanticColors: {diffAdded: '#34D399', diffRemoved: '#FB7185', skill: '#A78BFA'},
    },
    advanced: {
      enabled: true,
      background: {image: state.customImage, opacity: .58, overlay: .56, blur: 0, position: 'center'},
      banner: {enabled: false, image: null, opacity: .45, height: 112, width: 720, position: 'top-center'},
      glass: {enabled: true, opacity: Number($('#custom-glass').value) / 100, blur: Number($('#custom-blur').value)},
      workbuddy: {
        composerAvatar: {
          image: state.customComposerAvatar,
          fit: $('#custom-avatar-fit').value,
          shape: $('#custom-avatar-shape').value,
        },
      },
      radius: Number($('#custom-radius').value), motion: 'subtle', sidebarWidth: 280,
    },
  };
}

function renderCustomEntitlement() {
  const entitlement = state.entitlement;
  const access = canAccessCustomStudio(entitlement);
  const slots = boundCustomProfileIds(entitlement);
  const selector = $('#custom-profile-slot');
  const previous = selector.value;
  const options = [];

  if (isVip()) {
    const automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = '按皮肤名称创建（VIP）';
    options.push(automatic);
  }
  for (const profileId of slots) {
    const option = document.createElement('option');
    option.value = profileId;
    option.textContent = `永久自定义位 · ${profileId}`;
    options.push(option);
  }
  if (options.length === 0) {
    const unavailable = document.createElement('option');
    unavailable.value = '';
    unavailable.textContent = '需要 VIP 或永久自定义位授权';
    unavailable.disabled = true;
    unavailable.selected = true;
    options.push(unavailable);
  }
  selector.replaceChildren(...options);
  if ([...selector.options].some((option) => option.value === previous && !option.disabled)) {
    selector.value = previous;
  }
  selector.disabled = !access || (slots.length === 1 && !isVip());
  $('#custom-slot-help').textContent = isVip()
    ? (slots.length ? 'VIP 可新建任意皮肤，也可以继续编辑已永久绑定的自定义位。' : 'VIP 可按名称创建并保存任意自定义皮肤。')
    : slots.length
      ? '此授权只能保存和应用到已永久绑定的 profileId，不能换绑。'
      : '预览免费；保存和应用需要有效 VIP 或一个永久自定义位授权。';
  $('#custom-access-badge').textContent = isVip() ? 'VIP 已解锁' : slots.length ? '永久位已解锁' : 'VIP / 永久位';
  $('#custom-lock').hidden = access;
}

function renderCustomPreview() {
  const preview = $('#custom-preview');
  const surface = $('#custom-surface').value;
  const accent = $('#custom-accent').value;
  const opacity = Number($('#custom-glass').value) / 100;
  const radius = Number($('#custom-radius').value);
  const image = state.customImage ? `url(${JSON.stringify(state.customImage)}) center / cover, ` : '';
  preview.style.background = `${image}radial-gradient(circle at 75% 12%, ${accent}73, transparent 35%), ${surface}`;
  preview.style.borderRadius = `${radius + 8}px`;
  preview.style.colorScheme = $('#custom-theme-mode').value;
  preview.dataset.themeMode = $('#custom-theme-mode').value;
  preview.style.setProperty('--preview-panel', hexToRgba(surface, opacity));
  $('.mock-sidebar', preview).style.background = hexToRgba(surface, opacity);
  $('.mock-card', preview).style.background = hexToRgba(surface, opacity);
  $('.mock-input', preview).style.background = hexToRgba(surface, Math.min(.96, opacity + .08));
  $('.mock-sidebar i:first-child', preview).style.background = accent;
  const avatar = $('#mock-composer-avatar');
  avatar.hidden = !state.customComposerAvatar;
  avatar.style.backgroundImage = state.customComposerAvatar ? `url(${JSON.stringify(state.customComposerAvatar)})` : '';
  avatar.style.backgroundSize = $('#custom-avatar-fit').value;
  avatar.style.borderRadius = {circle: '50%', rounded: '10px', square: '0'}[$('#custom-avatar-shape').value];
}

function renderFreeWorkbuddy() {
  const freeBrand = state.freeBrand || {};
  $('#free-home-title').value = freeBrand.displayName || '';
  $('#free-home-tagline').value = freeBrand.tagline || '';
  state.freeComposerAvatar = freeBrand.composerAvatarImage || null;
  const preview = $('#free-avatar-preview');
  preview.textContent = state.freeComposerAvatar ? '' : '猫';
  preview.style.backgroundImage = state.freeComposerAvatar ? `url(${JSON.stringify(state.freeComposerAvatar)})` : '';
  preview.classList.toggle('has-image', Boolean(state.freeComposerAvatar));
}

async function saveFreeWorkbuddy(event) {
  event.preventDefault();
  const button = $('#save-free-workbuddy');
  setBusy(button, true, '正在保存…');
  try {
    const payload = await api('/api/free-brand', {method: 'POST', body: {
      clientId: 'workbuddy',
      displayName: $('#free-home-title').value.trim() || null,
      tagline: $('#free-home-tagline').value.trim() || null,
      iconImage: state.freeBrand?.iconImage || null,
      composerAvatarImage: state.freeComposerAvatar,
    }});
    state.freeBrand = payload.freeBrand;
    renderFreeWorkbuddy();
    const activeProfileId = state.status?.clients?.workbuddy?.session?.profileId;
    if (activeProfileId) {
      const activeSkin = skinById(activeProfileId);
      await requestApply(activeProfileId, activeSkin?.name || activeProfileId);
      toast('免费设置已保存，确认重启 WorkBuddy 后立即生效', 'success');
    } else {
      toast('免费设置已保存，下次应用 WorkBuddy 皮肤时生效', 'success');
    }
  } finally {
    setBusy(button, false);
  }
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const numbers = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  return `rgba(${numbers.join(',')},${alpha})`;
}

async function encodeImage(file, {
  maxDimension = 4096,
  maxPixels = 16 * 1024 * 1024,
  maxOutputBytes = 4 * 1024 * 1024,
  alpha = false,
} = {}) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('只接受 PNG、JPEG 或 WebP');
  if (file.size > 20 * 1024 * 1024) throw new Error('原图不能超过 20 MB');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDimension / bitmap.width, maxDimension / bitmap.height, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {alpha});
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', .86));
    if (!blob || blob.size > maxOutputBytes) throw new Error(`重编码后图片仍超过 ${Math.round(maxOutputBytes / 1024 / 1024)} MB，请选择更简单的图片`);
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法读取重编码图片'));
      reader.readAsDataURL(blob);
    });
  } finally { bitmap.close(); }
}

async function saveCustom(event) {
  event.preventDefault();
  const profile = customProfile();
  if (!canPersistCustomProfile(state.entitlement, profile.id)) {
    showView('vip');
    toast('保存需要有效 VIP，或与这个 profileId 精确绑定的永久自定义位授权', 'info');
    return;
  }
  const button = $('#save-custom');
  setBusy(button, true, '正在保存…');
  try {
    const payload = await api('/api/profiles', {method: 'POST', body: profile});
    state.profiles = (await api('/api/profiles')).profiles;
    toast(`已保存「${payload.profile.name}」`, 'success');
    await requestApply(payload.profile.id, payload.profile.name);
  } finally { setBusy(button, false); }
}

function renderDiagnostics() {
  if (!state.status) return;
  const cards = orderedClients().map((clientId) => {
    const record = state.status.clients[clientId];
    const card = document.createElement('article');
    card.className = 'card diagnostic-card';
    const level = record?.compatibility?.level || 'blocked';
    const status = level === 'exact' ? '精确适配' : level === 'generic-safe' ? '基础适配' : '已阻断';
    card.innerHTML = `<div class="diagnostic-card-header"><div class="diagnostic-title"><span class="client-logo ${clientId}-logo">${clientGlyph(clientId)}</span><h2>${clientNames[clientId]}</h2></div><span class="status-badge ${level === 'exact' ? 'ready' : level === 'blocked' ? 'blocked' : ''}">${record?.installed ? status : '未安装'}</span></div>`;
    const dl = document.createElement('dl');
    const rows = [
      ['版本', record?.version || '—'],
      ['官方签名', record?.signatureValid && record?.trustedPublisher ? '已验证' : '未通过'],
      ['适配层', record?.compatibility?.adapter?.adapterId || (level === 'generic-safe' ? '安全基础层' : '—')],
      ['CDP', record?.session?.mode ? `安全 ${record.session.mode}` : '未启用'],
      ['运行状态', record?.running ? '正在运行' : (record?.processScanError ? '受系统权限限制' : '未运行')],
    ];
    for (const [key, value] of rows) {
      const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = key;
      const dd = document.createElement('dd'); dd.textContent = value;
      row.append(dt, dd); dl.append(row);
    }
    card.append(dl);
    return card;
  });
  $('#diagnostic-clients').replaceChildren(...cards);
}

async function refreshLogs() {
  const payload = await api('/api/logs');
  const list = $('#log-list');
  const logs = payload.logs.length ? payload.logs.slice().reverse() : [{time: new Date().toISOString(), level: 'info', message: '暂无事件'}];
  list.replaceChildren(...logs.map((log) => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = new Date(log.time).toLocaleString('zh-CN', {hour12: false});
    const level = document.createElement('span');
    level.className = log.level;
    level.textContent = log.level.toUpperCase();
    const message = document.createElement('span');
    message.textContent = log.message;
    item.append(time, level, message);
    return item;
  }));
}

async function activateLicense(event) {
  event.preventDefault();
  const code = $('#license-token').value.trim();
  if (!code) { toast('请先粘贴授权码', 'error'); return; }
  const button = $('#license-form button[type="submit"]');
  setBusy(button, true, '正在验证…');
  try {
    // The local API accepts an authorization *code*, never an ambiguous
    // `token` field. Keeping this aligned with the native menu-bar client
    // prevents the dashboard from silently sending a request the server must
    // reject under its strict allowlist.
    const payload = await api('/api/license/activate', {method: 'POST', body: {code}});
    state.entitlement = payload.entitlement;
    renderEntitlement();
    toast(payload.entitlement.tier === 'vip' ? 'VIP 权益已同步' : '权益租约已同步', 'success');
  } finally { setBusy(button, false); }
}

function renderProducts() {
  const grid = $('#product-plans');
  if (!grid || !state.products) return;
  const freePlan = $('.free-plan', grid);
  if (!freePlan) return;
  const commerceReady = state.products.commerce?.checkoutEnabled === true;
  const cards = state.products.products.map((product) => {
    const card = document.createElement('article');
    card.className = `plan-card${product.offerType === 'vip_subscription' ? ' featured' : ''}`;
    card.dataset.catalogProductId = product.id;
    const label = document.createElement('span');
    label.className = 'plan-label';
    label.textContent = product.billing.kind === 'subscription'
      ? (product.billing.interval === 'year' ? 'VIP · YEARLY' : 'VIP · MONTHLY')
      : 'PERMANENT';
    const title = document.createElement('h2');
    title.textContent = product.name;
    const summary = document.createElement('p');
    summary.textContent = product.summary;
    const features = document.createElement('ul');
    for (const feature of product.features) {
      const item = document.createElement('li');
      item.textContent = feature;
      features.append(item);
    }
    const availability = document.createElement('small');
    availability.textContent = commerceReady
      ? '可信支付服务已配置；下单仍以服务端返回的 Checkout 为准。'
      : '购买服务尚未配置，不会伪装下单或解锁。';
    card.append(label, title, summary, features, availability);
    return card;
  });
  grid.replaceChildren(freePlan, ...cards);
}

function renderEntitlement() {
  const vip = isVip();
  const paidSkins = state.entitlement.skinIds?.length ?? 0;
  const customSlots = state.entitlement.customProfileIds?.length ?? 0;
  const permanent = paidSkins > 0 || customSlots > 0;
  const trial = state.entitlement.trial;
  const localTrialActive = state.entitlement.source === 'local-trial' && trial?.state === 'active';
  const localTrialExpired = state.entitlement.source !== 'license' && trial?.state === 'expired';
  $('#account-avatar').textContent = localTrialActive ? '7' : vip ? 'V' : permanent ? '购' : '免';
  $('#license-state').textContent = localTrialActive
    ? `${localTrialCopy(trial)} 这是本机试用，不是 Dodo 订阅或授权码；移除本机授权缓存不会重置试用。`
    : vip
    ? `VIP 已激活${state.entitlement.license?.expiresAt ? `，有效至 ${new Date(state.entitlement.license.expiresAt).toLocaleDateString('zh-CN')}` : ''}`
    : permanent
      ? `永久权益已同步：单套皮肤 ${paidSkins}，自定义位 ${customSlots}。移除本机缓存不会解除服务端绑定。`
      : localTrialExpired
        ? `${localTrialCopy(trial)} 免费皮肤仍可使用。`
      : state.entitlement.issuerConfigured
      ? '当前为免费版。客户端只接受签名权益租约，不会根据 Product ID 自行解锁。'
      : '当前为免费版。可信支付与发行服务尚未配置，本版本不会伪装成已可购买。';
  $('#schedule-lock').hidden = hasEntitlementPermission(state.entitlement, 'weeklySchedule');
  renderCustomEntitlement();
  renderCatalog();
  renderWeek();
}

async function removeLicense() {
  const payload = await api('/api/license/remove', {method: 'POST', body: {}});
  state.entitlement = payload.entitlement;
  $('#license-token').value = '';
  renderEntitlement();
  toast('已移除本机授权缓存', 'success');
}

async function toggleLoginAgent() {
  const enabled = state.status?.loginAgent?.managed === true;
  if (!enabled && !hasEntitlementPermission(state.entitlement, 'loginReminder')) {
    showView('vip');
    toast('随登录启动提醒服务需要 VIP', 'info');
    return;
  }
  const button = $('#toggle-login-agent');
  setBusy(button, true, enabled ? '正在关闭…' : '正在开启…');
  try {
    const payload = await api('/api/login-agent', {
      method: 'POST',
      body: {action: enabled ? 'remove' : 'install'},
    });
    state.status.loginAgent = payload.loginAgent;
    renderLoginAgent();
    toast(enabled ? '已关闭；下次登录不再启动提醒服务' : '已开启；下次登录时生效', 'success');
  } finally {
    setBusy(button, false);
    renderLoginAgent();
  }
}

function maybeShowReminder() {
  const reminder = state.status?.reminders?.[0];
  if (!reminder) return;
  const key = `${reminder.clientId}:${reminder.dateKey}:${reminder.skinId}`;
  if (state.shownReminderKey === key || $('#reminder-dialog').open) return;
  state.shownReminderKey = key;
  $('#reminder-title').textContent = `${reminder.clientName} 今天安排了「${reminder.skinName}」`;
  $('#reminder-copy').textContent = '现在切换会正常重启应用。你也可以一小时后再提醒，或今天跳过。';
  $('#reminder-dialog').dataset.clientId = reminder.clientId;
  $('#reminder-dialog').dataset.skinId = reminder.skinId;
  $('#reminder-dialog').dataset.skinName = reminder.skinName;
  $('#reminder-dialog').showModal();
}

async function reminderDecision(action) {
  const dialog = $('#reminder-dialog');
  const clientId = dialog.dataset.clientId;
  const skinId = dialog.dataset.skinId;
  const skinName = dialog.dataset.skinName;
  const payload = await api('/api/reminders/decision', {
    method: 'POST', body: {clientId, action, minutes: 60},
  });
  dialog.close(action);
  if (action === 'snooze') toast('一小时后再提醒', 'success');
  if (action === 'skip') toast('今天不会再提醒', 'success');
  if (action === 'apply') {
    state.selectedClient = clientId;
    renderStatus();
    // A schedule decision prepares a server-bound Apply Intent but does not
    // consume today's reminder. Reuse that exact intent so the server can
    // claim the reminder only after the restart and skin injection succeed.
    if (payload.intent) {
      openApplyDialog(payload.intent, skinName);
    } else {
      // Compatibility fallback for a locally running older backend.
      const intent = await api('/api/apply-intents', {
        method: 'POST', body: {clientId, skinId: payload.skinId || skinId, operation: 'apply'},
      });
      openApplyDialog(intent.intent, skinName);
    }
  }
}

async function refreshStatus(fresh = false) {
  const payload = fresh
    ? await api('/api/doctor/refresh', {method: 'POST', body: {}})
    : await api('/api/status');
  state.status = payload;
  state.entitlement = payload.entitlement;
  renderStatus();
  renderEntitlement();
}

function showError(error) {
  console.error(error);
  toast(error?.message || '操作失败', 'error');
}

function wireEvents() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  $$('[data-open-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.openView)));
  $$('[data-nav]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); showView(link.dataset.nav); }));
  $$('.client-option').forEach((button) => button.addEventListener('click', () => {
    switchClient(button.dataset.client).catch(showError);
  }));
  $$('.filter-pills button').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    $$('.filter-pills button').forEach((item) => item.classList.toggle('active', item === button));
    renderCatalog();
  }));
  $('#refresh-status').addEventListener('click', () => refreshStatus(true).catch(showError));
  $('#doctor-refresh').addEventListener('click', () => refreshStatus(true).then(() => toast('安全检测已更新', 'success')).catch(showError));
  $('#restore-current').addEventListener('click', () => requestRestore().catch(showError));
  $('#confirm-apply').addEventListener('click', confirmIntent);
  $('#apply-dialog').addEventListener('close', () => {
    if ($('#apply-dialog').returnValue !== 'confirmed') state.pendingIntent = null;
  });
  $('#save-schedule').addEventListener('click', () => saveSchedule().catch(showError));
  $('#schedule-enabled').addEventListener('change', () => { if (state.schedule) state.schedule.enabled = $('#schedule-enabled').checked; });
  $('#custom-form').addEventListener('submit', (event) => saveCustom(event).catch(showError));
  $('#preview-custom').addEventListener('click', () => { renderCustomPreview(); toast('预览已更新；没有连接目标应用', 'success'); });
  for (const id of ['custom-theme-mode', 'custom-accent', 'custom-surface', 'custom-ink', 'custom-glass', 'custom-blur', 'custom-radius']) {
    $(`#${id}`).addEventListener('input', () => {
      $('#custom-glass-value').textContent = `${$('#custom-glass').value}%`;
      $('#custom-blur-value').textContent = `${$('#custom-blur').value} px`;
      $('#custom-radius-value').textContent = `${$('#custom-radius').value} px`;
      renderCustomPreview();
    });
  }
  $('#custom-image').addEventListener('change', async () => {
    try {
      const file = $('#custom-image').files[0];
      if (!file) return;
      state.customImage = await encodeImage(file);
      renderCustomPreview();
      toast('图片已在本地重编码为静态 WebP', 'success');
    } catch (error) { showError(error); $('#custom-image').value = ''; }
  });
  $('#clear-image').addEventListener('click', () => { state.customImage = null; $('#custom-image').value = ''; renderCustomPreview(); });
  $('#custom-composer-avatar').addEventListener('change', async () => {
    try {
      const file = $('#custom-composer-avatar').files[0];
      if (!file) return;
      state.customComposerAvatar = await encodeImage(file, {
        maxDimension: 2048,
        maxPixels: 4 * 1024 * 1024,
        maxOutputBytes: 2 * 1024 * 1024,
        alpha: true,
      });
      renderCustomPreview();
      toast('WorkBuddy 输入框头像已在本地安全重编码', 'success');
    } catch (error) { showError(error); $('#custom-composer-avatar').value = ''; }
  });
  for (const id of ['custom-avatar-fit', 'custom-avatar-shape']) {
    $(`#${id}`).addEventListener('change', renderCustomPreview);
  }
  $('#clear-composer-avatar').addEventListener('click', () => {
    state.customComposerAvatar = null;
    $('#custom-composer-avatar').value = '';
    renderCustomPreview();
  });
  $('#free-workbuddy-form').addEventListener('submit', (event) => saveFreeWorkbuddy(event).catch(showError));
  $('#free-composer-avatar').addEventListener('change', async () => {
    try {
      const file = $('#free-composer-avatar').files[0];
      if (!file) return;
      state.freeComposerAvatar = await encodeImage(file, {
        maxDimension: 2048,
        maxPixels: 4 * 1024 * 1024,
        maxOutputBytes: 2 * 1024 * 1024,
        alpha: true,
      });
      const preview = $('#free-avatar-preview');
      preview.textContent = '';
      preview.style.backgroundImage = `url(${JSON.stringify(state.freeComposerAvatar)})`;
      preview.classList.add('has-image');
      toast('免费头像已在本机安全重编码', 'success');
    } catch (error) { showError(error); $('#free-composer-avatar').value = ''; }
  });
  $('#clear-free-composer-avatar').addEventListener('click', () => {
    state.freeComposerAvatar = null;
    $('#free-composer-avatar').value = '';
    const preview = $('#free-avatar-preview');
    preview.textContent = '猫';
    preview.style.backgroundImage = '';
    preview.classList.remove('has-image');
  });
  $('#license-form').addEventListener('submit', (event) => activateLicense(event).catch(showError));
  $('#remove-license').addEventListener('click', () => removeLicense().catch(showError));
  $('#toggle-login-agent').addEventListener('click', () => toggleLoginAgent().catch(showError));
  $('#refresh-logs').addEventListener('click', () => refreshLogs().catch(showError));
  $('#reminder-skip').addEventListener('click', (event) => { event.preventDefault(); reminderDecision('skip').catch(showError); });
  $('#reminder-snooze').addEventListener('click', (event) => { event.preventDefault(); reminderDecision('snooze').catch(showError); });
  $('#reminder-apply').addEventListener('click', (event) => { event.preventDefault(); reminderDecision('apply').catch(showError); });
  $('#shutdown-button').addEventListener('click', async () => {
    try {
      await api('/api/shutdown', {method: 'POST', body: {}});
      document.body.innerHTML = '<main class="shutdown-message"><h1>灵妆已退出</h1><p>可以关闭这个页面。</p></main>';
    } catch (error) { showError(error); }
  });
}

async function init() {
  state.token = tokenFromHash();
  if (!state.token) throw new Error('缺少本地会话令牌，请从灵妆启动器重新打开');
  wireEvents();
  const [status, schedule, profiles, products, freeBrand] = await Promise.all([
    api('/api/status'),
    api('/api/schedule'),
    api('/api/profiles'),
    api('/api/products'),
    api('/api/free-brand?clientId=workbuddy'),
  ]);
  state.status = status;
  state.entitlement = status.entitlement;
  state.catalogByClient[state.selectedClient] = (await api(`/api/catalog?clientId=${encodeURIComponent(state.selectedClient)}`)).skins;
  state.catalog = state.catalogByClient[state.selectedClient];
  state.schedule = schedule.schedule;
  state.profiles = profiles.profiles;
  state.products = products;
  state.freeBrand = freeBrand.freeBrand;
  renderStatus();
  renderCatalog();
  renderWeek();
  renderEntitlement();
  renderProducts();
  renderCustomPreview();
  renderFreeWorkbuddy();
  refreshLogs().catch(showError);
  setInterval(() => refreshStatus(false).catch(() => {}), 15000);
}

init().catch((error) => {
  console.error(error);
  const main = $('#main');
  if (main) main.innerHTML = `<section class="card safety-card"><div><h1>无法打开灵妆</h1><p>${String(error.message).replace(/[<>]/g, '')}</p></div></section>`;
});
