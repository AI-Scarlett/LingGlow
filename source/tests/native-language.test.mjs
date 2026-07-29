import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';

const sourceDirectory = new URL('../native/Sources/', import.meta.url);
const sourceNames = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.swift')).sort();
const sourceEntries = await Promise.all(sourceNames.map(async (name) => [
  name,
  await readFile(new URL(name, sourceDirectory), 'utf8'),
]));
const sourceByName = new Map(sourceEntries);
const allSources = sourceEntries.map(([, source]) => source).join('\n');
const views = sourceByName.get('Views.swift');
const model = sourceByName.get('StudioModel.swift');
const appMain = sourceByName.get('AppMain.swift');
const models = sourceByName.get('Models.swift');
const generatedRegistry = sourceByName.get('GeneratedClientRegistry.swift');
const english = await readFile(new URL('../native/Resources/Localizations/en.lproj/Localizable.strings', import.meta.url), 'utf8');
const capabilitySchema = await readFile(new URL('../src/capability-schema.mjs', import.meta.url), 'utf8');
const products = await readFile(new URL('../src/products.mjs', import.meta.url), 'utf8');
const catalogDirectories = [
  new URL('../catalog/skins/', import.meta.url),
  new URL('../catalog/theme-packs/', import.meta.url),
];
const catalogDocuments = [];
for (const directory of catalogDirectories) {
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    catalogDocuments.push(JSON.parse(await readFile(new URL(name, directory), 'utf8')));
  }
}

const localizationPairs = [...english.matchAll(/^\s*"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)";/gmu)]
  .map((match) => [match[1], match[2]]);
const englishByKey = new Map(localizationPairs);
const containsHan = (value) => /[\p{Script=Han}]/u.test(value);
const formatTokens = (value) => value.match(/%(?:@|lld|ld|d|f)/gu) ?? [];

function catalogValues() {
  const values = new Set();
  for (const match of capabilitySchema.matchAll(/(?:group|description):\s*'([^']*[\p{Script=Han}][^']*)'/gu)) {
    values.add(match[1]);
  }
  for (const match of products.matchAll(/(?:name|summary):\s*'([^']*[\p{Script=Han}][^']*)'/gu)) {
    values.add(match[1]);
  }
  for (const match of products.matchAll(/features:\s*\[([^\]]*)\]/gu)) {
    for (const feature of match[1].matchAll(/'([^']*[\p{Script=Han}][^']*)'/gu)) values.add(feature[1]);
  }
  for (const document of catalogDocuments) {
    if (containsHan(document.name ?? '')) values.add(document.name);
    if (containsHan(document.description ?? '')) values.add(document.description);
  }
  return values;
}

test('native language picker updates every native surface without changing global AppleLanguages', () => {
  assert.match(views, /\.environment\(\\\.locale, model\.interfaceLocale\)/u);
  assert.match(views, /\.id\(model\.interfaceLanguage\)/u);
  assert.match(views, /model\.setInterfaceLanguage\(\$0\)/u);
  assert.match(views, /切换后立即生效/u);
  assert.doesNotMatch(allSources, /forKey:\s*"AppleLanguages"|setPersistentDomain/u);
  assert.doesNotMatch(views, /重新启动灵妆|Restart LingGlow/u);
  assert.match(model, /@Published var interfaceLanguage = StudioModel\.savedInterfaceLanguage\(\)/u);
  assert.match(model, /func setInterfaceLanguage\(_ value: String\)/u);
  assert.match(model, /LingGlowL10n\.preferenceKey/u);
  assert.match(model, /UserDefaults\.standard\.set\(normalized,[\s\S]{0,720}interfaceLanguage = normalized/u);
  assert.match(model, /clearMessages\(\)[\s\S]{0,120}interfaceLanguage = normalized/u);
  assert.match(appMain, /model\.\$interfaceLanguage[\s\S]*configureStatusMenu\(\)/u);
  assert.match(models, /enum StudioTab[\s\S]*LingGlowL10n\.string/u);
  assert.match(generatedRegistry, /var displayName: String[\s\S]*LingGlowL10n\.string/u);
  assert.match(english, /Changes apply immediately\./u);
});

test('embedded service lifecycle is automatic and never asks the user to connect it', () => {
  assert.match(model, /case \.starting: return LingGlowL10n\.string\("灵妆正在准备"\)/u);
  assert.match(model, /case \.connected: return LingGlowL10n\.string\("灵妆已就绪"\)/u);
  assert.match(model, /case \.disconnected: return LingGlowL10n\.string\("灵妆正在自动恢复"\)/u);
  assert.match(model, /connectionState == \.connected[\s\S]{0,180}15_000_000_000[\s\S]{0,120}2_000_000_000/u);
  assert.match(model, /registerConnectionFailure\(error, showMessage: false\)/u);
  assert.match(model, /无需手动连接/u);
  assert.match(views, /灵妆正在准备皮肤目录…/u);
  assert.doesNotMatch(views, /连接本地服务后显示目录/u);
  assert.equal(englishByKey.get('灵妆正在准备'), 'LingGlow is getting ready');
  assert.equal(englishByKey.get('灵妆已就绪'), 'LingGlow is ready');
  assert.equal(
    englishByKey.get('灵妆内置功能正在自动恢复，无需手动连接；请稍候。'),
    'LingGlow is restoring its built-in service automatically; no manual connection is needed. Please wait.',
  );
});

test('purchase consent sheet uses the selected LingGlow language instead of the system sheet locale', () => {
  const sheet = views.slice(
    views.indexOf('private struct PurchaseConsentSheet'),
    views.indexOf('private struct DodoProductCard'),
  );
  for (const key of [
    '确认购买协议',
    '灵妆提供即时交付的数字授权与虚拟服务。除适用法律或 Dodo Payments 规则另有规定外，购买后不支持退货退款。',
    '我已阅读并同意《购买说明》和《隐私政策》',
    '购买说明',
    '隐私政策',
    '取消',
    '确认并前往购买',
  ]) {
    assert.ok(sheet.includes(`LingGlowL10n.string("${key}")`), `${key} must use the app-owned language selector`);
  }
  assert.doesNotMatch(sheet, /(?:Text|Toggle|Button)\("确认购买协议"/u);
});

test('skin and custom unlock sheet keeps the selected LingGlow language in its AppKit sheet host', () => {
  const unlockSheet = views.slice(
    views.indexOf('private struct LicenseUnlockSheet'),
    views.indexOf('private struct CustomSkinsView'),
  );
  assert.match(unlockSheet, /\.environment\(\\\.locale, model\.interfaceLocale\)/u);
  assert.match(unlockSheet, /LingGlowL10n\.string\("解锁「%@」"/u);
  assert.match(unlockSheet, /LingGlowL10n\.string\("解锁自定义皮肤"\)/u);
});

test('multi-Agent apply sheet never mixes the macOS locale with LingGlow language', () => {
  const sheet = views.slice(
    views.indexOf('private struct SkinAgentApplySheet'),
    views.indexOf('private enum LicenseUnlockTarget'),
  );
  assert.match(sheet, /\.environment\(\\\.locale, model\.interfaceLocale\)/u);
  for (const key of [
    '勾选要使用这套皮肤的 Agent，一次确认即可。',
    '应用结果',
    '只会退出并重启已勾选的 Agent，请先保存尚未提交的内容。',
    '完成',
    '取消',
    '正在应用…',
  ]) {
    assert.ok(sheet.includes(`LingGlowL10n.string("${key}")`), `${key} must use LingGlowL10n`);
  }
});

test('free appearance and custom editors keep literal and dynamic labels in one language', () => {
  const freeEditor = views.slice(
    views.indexOf('private struct FreeAppearanceEditor: View'),
    views.indexOf('private struct AgentCustomEditor: View'),
  );
  const customEditor = views.slice(
    views.indexOf('private struct AgentCustomEditor: View'),
    views.indexOf('private struct LocalImagePickerCard: View'),
  );
  assert.match(freeEditor, /\.environment\(\\\.locale, model\.interfaceLocale\)/u);
  assert.match(customEditor, /\.environment\(\\\.locale, model\.interfaceLocale\)/u);
});

test('English runtime errors cannot leak untranslated Chinese diagnostics', () => {
  const localization = sourceByName.get('Localization.swift');
  const backend = sourceByName.get('Backend.swift');

  assert.match(localization, /static func error\(_ message: String\) -> String/u);
  assert.match(localization, /message\.hasPrefix\(startupPrefix\)/u);
  assert.match(localization, /return string\("操作失败，请稍后重试"\)/u);
  assert.match(backend, /case \.backendUnavailable\(let message\): return LingGlowL10n\.error\(message\)/u);
  assert.match(backend, /case \.api\(_, let message, _\): return LingGlowL10n\.error\(message\)/u);
  assert.equal(englishByKey.get('内置服务启动失败：%@'), 'Embedded service failed to start: %@');
  assert.equal(englishByKey.get('另一个灵妆实例正在启动；请稍后重试'), 'Another LingGlow instance is starting. Please try again shortly.');
});

test('every Chinese Swift string literal has a non-Chinese English resource', () => {
  const missing = [];
  for (const [name, source] of sourceEntries) {
    for (const match of source.matchAll(/"((?:\\.|[^"\\])*)"/gu)) {
      const key = match[1];
      if (!containsHan(key) || key.includes('\\(')) continue;
      if (!englishByKey.has(key)) missing.push(`${name}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);

  const untranslated = localizationPairs.filter(([key, value]) => key !== '中文' && containsHan(value));
  assert.deepEqual(untranslated, []);

  const duplicateKeys = localizationPairs
    .map(([key]) => key)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicateKeys, []);
});

test('dynamic product and capability copy is present in the native English catalog', () => {
  const missing = [...catalogValues()].filter((key) => !englishByKey.has(key)).sort();
  assert.deepEqual(missing, []);
});

test('localized format strings preserve their substitution contract', () => {
  const mismatches = localizationPairs
    .filter(([key]) => formatTokens(key).length > 0)
    .filter(([key, value]) => formatTokens(key).join(',') !== formatTokens(value).join(','));
  assert.deepEqual(mismatches, []);
});
