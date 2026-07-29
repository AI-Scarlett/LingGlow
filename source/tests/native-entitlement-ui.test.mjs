import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const models = fs.readFileSync(path.join(ROOT, 'native', 'Sources', 'Models.swift'), 'utf8');
const backend = fs.readFileSync(path.join(ROOT, 'native', 'Sources', 'Backend.swift'), 'utf8');
const studioModel = fs.readFileSync(path.join(ROOT, 'native', 'Sources', 'StudioModel.swift'), 'utf8');
const views = fs.readFileSync(path.join(ROOT, 'native', 'Sources', 'Views.swift'), 'utf8');
const nativeAlerts = fs.readFileSync(path.join(ROOT, 'native', 'Sources', 'NativeAlerts.swift'), 'utf8');
const appMain = fs.readFileSync(path.join(ROOT, 'native', 'Sources', 'AppMain.swift'), 'utf8');
const skinPreview = fs.readFileSync(path.join(ROOT, 'native', 'Sources', 'SkinPreview.swift'), 'utf8');
const swiftSources = fs.readdirSync(path.join(ROOT, 'native', 'Sources'))
  .filter((name) => name.endsWith('.swift'))
  .map((name) => fs.readFileSync(path.join(ROOT, 'native', 'Sources', name), 'utf8'))
  .join('\n');

test('native entitlement policy gives VIP full catalog access and exact permanent-skin access', () => {
  assert.match(studioModel, /var isVIP: Bool \{ entitlement\?\.isVIP == true \}/u);
  assert.match(studioModel,
    /!skin\.isVIP[\s\S]{0,120}isVIP[\s\S]{0,120}entitlement\?\.purchasedSkinIds\.contains\(skin\.id\) == true/u);
  assert.doesNotMatch(studioModel, /skin\.hasOneTimeTrial/u);
  assert.doesNotMatch(views, /未购买可试用一次|一次性试用/u);
  assert.match(studioModel, /这套皮肤需要有效 VIP 或该皮肤的购买\/兑换授权/u);
});

test('native text fields expose standard Mac paste commands and a visible license paste fallback', () => {
  assert.match(appMain, /applicationDidFinishLaunching[\s\S]{0,220}configureMainMenu\(\)/u);
  assert.match(appMain, /NSApp\.mainMenu = mainMenu/u);
  for (const [selector, key] of [
    ['cut', 'x'],
    ['copy', 'c'],
    ['paste', 'v'],
    ['selectAll', 'a'],
  ]) {
    assert.match(
      appMain,
      new RegExp(`#selector\\(NSText\\.${selector}\\(_:\\)\\)[\\s\\S]{0,100}keyEquivalent: \"${key}\"`, 'u'),
      `${selector} must stay on the first-responder command chain`,
    );
  }
  const licenseCard = views.slice(
    views.indexOf('Label("兑换或同步授权码"'),
    views.indexOf('if model.entitlement?.activationConfigured != true'),
  );
  assert.match(licenseCard, /TextField\("粘贴授权码"/u);
  assert.doesNotMatch(licenseCard, /SecureField\("粘贴授权码"/u);
  assert.doesNotMatch(licenseCard, /privacySensitive\(\)/u);
  assert.match(licenseCard, /NSPasteboard\.general\.string\(forType: \.string\)/u);
  assert.match(licenseCard, /Label\("粘贴", systemImage: "doc\.on\.clipboard"\)/u);
  assert.match(licenseCard, /trimmingCharacters\(in: \.whitespacesAndNewlines\)/u);
});

test('native account UI labels the bounded local first-use VIP trial without treating it as a Dodo lease', () => {
  assert.match(models, /struct LocalVipTrialInfo: Decodable/u);
  assert.match(models, /let remainingSeconds: Int/u);
  assert.match(models, /let expiresAt: String/u);
  assert.match(models, /let trial: LocalVipTrialInfo\?/u);
  assert.match(models, /var remainingDisplay: String/u);
  assert.match(views, /7 天免费 VIP 试用中/u);
  assert.match(views, /本机首次使用免费 VIP · 剩余/u);
  assert.match(views, /不是 Dodo 订阅或授权码/u);
  assert.match(views, /移除本机授权缓存不会重置试用/u);
  assert.match(views, /if model\.entitlement\?\.license != nil/u,
    'trial-only access must not surface a misleading license-clear reset control');
});

test('native custom profile paths require the exact bound profileId and expose multiple slots', () => {
  assert.match(studioModel, /var customProfileSlotIds: \[String\]/u);
  assert.match(studioModel, /preferredProfileId: String\? = nil/u);
  assert.match(studioModel, /!allowedIds\.contains\(preferredProfileId\)/u);
  assert.ok((studioModel.match(/guard canPersistCustomProfile\(id: profile\.id\)/gu) ?? []).length >= 4,
    'legacy and union save/apply paths must all use exact profileId checks');
  assert.match(views, /Picker\("已购自定义位", selection: \$selectedSlotId\)/u);
  assert.match(views, /switchCustomSlot\(to: profileId\)/u);
  assert.match(views, /每个授权码只解锁一个固定 profileId/u);
});

test('native C-end UI makes product differences, custom schedules, blocked Agents, and real previews explicit', () => {
  assert.match(models, /struct ScheduleSkinOption: Identifiable/u);
  assert.match(studioModel, /func scheduleSkinOptions\(for client: ClientID\)/u);
  assert.match(views, /let scheduleSkinOptions = model\.scheduleSkinOptions\(for: model\.selectedClient\)/u);
  assert.match(views, /ForEach\(scheduleSkinOptions\)/u);
  assert.match(views, /ForEach\(product\.features, id: \\.self\)/u);
  assert.match(views, /存在兼容或安装问题，仍可尝试应用/u);
  assert.match(views, /兼容状态不会锁定皮肤/u);
  assert.match(views, /若目标未安装或签名异常/u);
  assert.match(views, /当前不能为 \\\(model\.selectedClient\.displayName\) 安排自动切换/u);
  assert.equal(views.includes('当前不能为 (model.selectedClient.displayName) 安排自动切换'), false);
  assert.match(views, /genericSafeClientNotice/u);
  assert.match(views, /当前为基础安全模式/u);
  assert.match(views, /仍可应用背景、色板、基础玻璃层和输入框机器人/u);
  assert.match(views, /完成当前版本的运行矩阵与恢复验证/u);
  assert.match(views, /基础安全映射/u);
  assert.match(views, /目标 Agent 已固定/u);
  assert.match(models, /let previewArtwork: String\?/u);
  assert.match(views, /if let artwork = skin\.previewArtwork/u);
  assert.match(views, /CachedLocalArtwork\(\s*dataURL: artwork,/u);
  assert.match(views, /LocalImageAsset\.chooseProjectHero\(\)/u);
  assert.match(studioModel, /createReapplyCurrentClientIntent/u);
  assert.match(views, /保存并重新应用/u);
  assert.match(views, /schema\?\.capabilityMap\.runtimeStatus == "available"/u);
});

test('mascot motion stays profile-scoped instead of exposing one global free override', () => {
  const skinsBody = views.slice(
    views.indexOf('private struct SkinsView: View'),
    views.indexOf('private enum LicenseUnlockTarget'),
  );
  assert.match(skinsBody, /clientSummary\s+freeBrandSummary/u);
  assert.match(skinsBody, /动作由每张皮肤独立决定/u);
  const freeEditor = views.slice(
    views.indexOf('private struct FreeAppearanceEditor: View'),
    views.indexOf('private struct AgentCustomEditor: View'),
  );
  assert.doesNotMatch(freeEditor, /Picker\("动作"|composerAvatarMotion = "inherit"/u);
  assert.match(freeEditor, /composerAvatarMotion: nil/u);
  assert.match(models, /var composerAvatarMotion: String\?/u);
});

test('catalog Apply opens one multi-Agent confirmation and preserves per-Agent intent checks', () => {
  const skinsBody = views.slice(
    views.indexOf('private struct SkinsView: View'),
    views.indexOf('private enum LicenseUnlockTarget'),
  );
  assert.match(skinsBody, /@State private var applyingSkin: CatalogSkin\?/u);
  assert.match(skinsBody, /\.sheet\(item: \$applyingSkin\)[\s\S]{0,300}SkinAgentApplySheet/u);
  assert.match(skinsBody, /private struct SkinAgentApplySheet: View/u);
  assert.match(skinsBody, /@State private var selectedClients: Set<ClientID>/u);
  assert.match(skinsBody, /selectedClients\.formIntersection\(available\)/u,
    'an unavailable initial Agent must not stay selected');
  assert.match(skinsBody, /private var selectedSelectableClients: Set<ClientID>/u);
  assert.match(skinsBody, /ForEach\(ClientID\.allCases\)/u);
  assert.match(skinsBody, /确认应用到 %lld 个 Agent/u);
  assert.match(skinsBody, /model\.applyCatalogSkin\(skin, to: clients\)/u);
  assert.match(skinsBody, /status\.compatibility\.level == "generic-safe"/u,
    'compatibility warnings must remain selectable instead of disabling the whole theme');
  assert.match(skinsBody, /可能存在适配问题 · %@/u);
  assert.match(views, /Label\("应用到…", systemImage: "checkmark"\)/u);

  const batchMethod = studioModel.slice(
    studioModel.indexOf('func applyCatalogSkin(_ skin: CatalogSkin'),
    studioModel.indexOf('func createRestoreIntent'),
  );
  assert.match(batchMethod, /ClientID\.allCases\.filter/u,
    'registry order must drive the batch and keep Codex last');
  assert.match(batchMethod, /createApplyIntentWithRecovery\([\s\S]{0,120}client: client/u);
  assert.match(batchMethod, /confirmApplyWithRecovery\([\s\S]{0,180}skinId: targetSkin\.id/u);
  assert.match(batchMethod, /Creating an intent is safe to retry once/u);
  assert.match(batchMethod, /A confirmation is not replayed/u);
  assert.match(batchMethod, /target\.session\.state == "active"[\s\S]{0,180}target\.session\.profileId == skinId/u);
  assert.match(batchMethod, /outcomes\.append\(AgentSkinApplyOutcome/u);
  assert.match(models, /struct AgentSkinApplyOutcome: Identifiable/u);
});

test('native Theme Pack cards label source assets through the current effective capability intersection', () => {
  assert.match(models, /let capabilities: \[String\]\?/u,
    'the native client must decode the server-computed runtime capability intersection');
  assert.match(models, /let hasBanner: Bool\?/u);
  assert.match(models, /var includesBanner: Bool \{ hasBanner == true \}/u);
  assert.match(models, /var isDesignPreviewOnly: Bool \{ designPreview == true \|\| runtimeStatus == "blocked" \}/u);

  assert.match(views, /effectiveCapabilities: Set\(model\.selectedStatus\?\.capabilities \?\? \[\]\)/u);
  assert.match(views, /featureBadge\("HERO", capability: "project-hero"/u);
  assert.match(views, /featureBadge\("BRAND", capability: "brand"/u);
  assert.match(views, /featureBadge\("BANNER", capability: "banner"/u);
  assert.match(views, /if skin\.isDesignPreviewOnly \{ return \.designPreview \}/u,
    'Doubao source art must remain design-only while runtimeStatus is blocked');
  assert.match(views, /if effectiveCapabilities\.contains\(capability\) \{ return \.supported \}/u,
    'WorkBuddy exact features may only be presented as supported after the effective intersection includes them');
  assert.match(views, /return \.deferred/u,
    'Codex generic-safe source Brand/Banner must be marked deferred rather than delivered');
  assert.match(views, /case \.deferred: return LingGlowL10n\.string\("待适配"\)/u);
  assert.match(views, /case \.designPreview: return LingGlowL10n\.string\("预览"\)/u);
  assert.match(views, /不会在应用结果中出现；需完成精确适配后才可使用/u);
  assert.match(views, /Codex 已启用兼容模式/u);
  assert.match(views, /部分位置可能存在适配问题/u);
  assert.match(views, /基础玻璃层和输入框机器人/u);
});

test('native blocked-Agent drafts stay isolated from executable union profiles and require exactly blocked status', () => {
  assert.match(studioModel, /@Published var unionProfileDrafts: \[UnionProfile\] = \[\]/u);
  assert.match(studioModel, /let latestDrafts = try await connected\.unionProfileDrafts\(\)\.profiles/u);
  assert.match(studioModel, /unionProfileDrafts = latestDrafts/u);
  assert.match(studioModel, /value\.capabilityMap\.runtimeStatus == "blocked"/u);
  assert.match(studioModel, /connected\.saveUnionProfileDraft\(profile\)/u);
  assert.match(studioModel, /schema\.capabilityMap\.runtimeStatus == "blocked"/u);
  assert.match(studioModel, /guard schema\.capabilityMap\.runtimeStatus == "available" else/u);
  assert.match(studioModel, /已保存不可执行设计草稿/u);
  assert.match(studioModel, /未注入、未加入排程，也不能应用/u);
  assert.match(studioModel, /guard !isUnionProfileDraft\(profile\) else/u);
  assert.match(studioModel, /func scheduleSkinOptions\(for client: ClientID\)/u);

  const scheduleMethod = studioModel.slice(
    studioModel.indexOf('func scheduleSkinOptions(for client: ClientID)'),
    studioModel.indexOf('func canPersistCustomProfile'),
  );
  assert.doesNotMatch(scheduleMethod, /unionProfileDrafts/u,
    'draft-only records must never be offered to the scheduler');
});

test('native draft UI permits entitled blocked design authoring but never enables application', () => {
  assert.match(views, /private var isBlockedAgent: Bool[\s\S]*runtimeStatus == "blocked"/u);
  assert.match(views, /private var canSaveBlockedDesignDraft: Bool/u);
  assert.match(views, /field\.editable \|\| canSaveBlockedDesignDraft/u);
  assert.match(views, /text: editable \? \(field\.editable \? "可编辑" : "草稿可编辑"\)/u);
  assert.match(views, /保存不可执行草稿/u);
  assert.match(views, /\.disabled\(isBlockedAgent \|\| isSavedDesignDraft \|\| !canApply\)/u);
  assert.match(views, /不会注入、不会进入排程、不能应用，也不会生成可执行皮肤/u);
  assert.match(views, /ClientPicker\(selection: \$selectedClient\)\s*\.disabled\(targetAgentIsLocked\)/u);
  assert.match(views, /这个已保存的方案目标 Agent 已固定/u);
  assert.match(views, /model\.unionProfileDrafts\.first/u);
});

test('native explicit draft promotion is confirmed, non-applying, and preserves first-save target choice', () => {
  assert.match(models, /struct DraftPromotionRequest: Encodable/u);
  assert.match(models, /let confirm: Bool/u);
  assert.match(nativeAlerts, /func presentDraftPromotionConfirmation\(_ profile: UnionProfile\) -> Bool/u);
  assert.match(nativeAlerts, /LingGlowL10n\.string\("提升「%@」为可执行皮肤？", profile\.name\)/u);
  assert.match(nativeAlerts, /不会应用、不会重启，也不会注入/u);
  assert.match(studioModel, /func promoteUnionProfileDraft\(_ profile: UnionProfile\) async -> UnionProfile\?/u);
  assert.match(studioModel, /connected\.promoteUnionProfileDraft\(profile\)/u);
  assert.match(studioModel, /LingGlowL10n\.string\("已提升「%@」为可执行皮肤；尚未应用", promoted\.name\)/u);
  assert.match(views, /presentDraftPromotionConfirmation\(draft\)/u);
  assert.match(views, /提升为可执行皮肤/u);

  const lockMethod = studioModel.slice(
    studioModel.indexOf('func isUnionProfileTargetLocked'),
    studioModel.indexOf('func checkoutUnavailableReason'),
  );
  assert.match(lockMethod, /unionProfiles\.contains/u);
  assert.match(lockMethod, /unionProfileDrafts\.contains/u);
  assert.doesNotMatch(lockMethod, /customProfileSlotIds\.contains/u,
    'a freshly redeemed but unsaved slot must still let its owner choose an Agent');

  const promotionMethod = studioModel.slice(
    studioModel.indexOf('func promoteUnionProfileDraft'),
    studioModel.indexOf('func createApplyIntent(for profile: UnionProfile)'),
  );
  assert.doesNotMatch(promotionMethod, /createIntent|confirm\(intent/u,
    'promotion must not create or confirm an apply intent');
});

test('native redemption never submits a skin choice before trusted SELECTION_REQUIRED', () => {
  assert.match(studioModel, /connected\.activateLicense\(code, skinId: nil\)/u);
  assert.match(studioModel, /guard errorCode == "SELECTION_REQUIRED"/u);
  assert.match(studioModel, /guard case let \.skin\(preferredSkin\) = context/u);
  assert.match(studioModel,
    /guard errorCode == "SELECTION_REQUIRED"[\s\S]{0,1800}loadProductCatalogIfNeeded\(force: true\)[\s\S]{0,500}redemptionSkins\.first/u,
    'a remote card must refresh the trusted redemption catalog after Dodo identifies a single-skin key');
  assert.match(views, /不会按当前页面猜测授权类型/u);
  assert.doesNotMatch(views, /Picker\("要绑定的 VIP 皮肤"/u);
});

test('native permanent-skin redemption requires a final irreversible confirmation for the exact selected skin', () => {
  assert.match(nativeAlerts, /func presentPermanentSkinRedemptionConfirmation\(_ skin: RedemptionSkin\) -> Bool/u);
  assert.match(nativeAlerts, /LingGlowL10n\.string\("永久绑定「%@」？", LingGlowL10n\.string\(skin\.name\)\)/u);
  assert.match(nativeAlerts, /不能改换成其他皮肤/u);
  assert.match(nativeAlerts, /永久绑定并继续/u);
  assert.match(studioModel, /redemptionSkins\.first\(where: \{ \$0\.id == preferredSkin\.id \}\)/u);
  assert.match(studioModel, /presentPermanentSkinRedemptionConfirmation\(permanentSkin\)/u);
  assert.match(studioModel, /connected\.activateLicense\(code, skinId: permanentSkin\.id\)/u);
  assert.ok(
    studioModel.indexOf('presentPermanentSkinRedemptionConfirmation(permanentSkin)') <
      studioModel.indexOf('connected.activateLicense(code, skinId: permanentSkin.id)'),
    'the immutable selection must be confirmed before it is submitted',
  );
});

test('catalog and custom pages share one closed-loop purchase and license-purpose flow', () => {
  assert.match(views, /private struct LicenseUnlockSheet: View/u);
  assert.match(views, /target: \.skin\(skin\)/u);
  assert.match(views, /target: \.customSlot/u);
  assert.match(views, /productCatalog\?\.products\.first\(where: \{ \$0\.offerType == target\.offerType \}\)/u);
  assert.match(views, /购买此皮肤授权/u);
  assert.match(views, /购买自定义皮肤位/u);
  assert.match(views, /识别授权码并解锁/u);
  assert.match(studioModel, /case skin\(CatalogSkin\)/u);
  assert.match(studioModel, /case customSlot/u);
  assert.match(studioModel, /case vip/u);
  assert.match(studioModel, /case customProfile\(String\)/u);
});

test('single-theme ownership is presented as an exact binding and the unlock sheet stays compact', () => {
  const unlockSheet = views.slice(
    views.indexOf('private struct LicenseUnlockSheet'),
    views.indexOf('private struct CustomSkinsView'),
  );
  assert.match(unlockSheet, /existingSkinBindingNotice/u);
  assert.match(unlockSheet, /当前永久授权已绑定「%@」；「%@」需要单独授权，原绑定不可切换。/u);
  assert.match(unlockSheet, /\.frame\(width: 560, height: 480\)/u);
  assert.doesNotMatch(unlockSheet, /LingGlowBackdrop\(\)/u);
  assert.match(views, /%lld 套永久皮肤已激活/u);
  assert.match(views, /%lld 个永久自定义位已激活/u);
});

test('native reminder apply consumes a server-prepared intent before the legacy skin-ID fallback', () => {
  assert.match(models, /let intent: ApplyIntent\?/u);
  assert.match(studioModel, /if let intent = decision\.intent \{\s*return intent\s*\}/u);
  assert.ok(
    studioModel.indexOf('if let intent = decision.intent') <
      studioModel.indexOf('return try await connected.createIntent(', studioModel.indexOf('func consumeReminder')),
    'a prepared reminder intent must be used before issuing a second request',
  );
});

test('test-only Dodo directory is an unconditional native purchase blocker', () => {
  assert.match(models, /var usesTestProductDirectory: Bool/u);
  assert.match(models, /productDirectoryEnvironment == "test_mode"/u);
  assert.match(studioModel, /guard !catalog\.commerce\.usesTestProductDirectory else/u);
  assert.match(views, /当前四个 Dodo Product ID 均属于测试环境，所有购买按钮已停用/u);
  assert.match(views, /\.disabled\(unavailableReason != nil\)/u);
});

test('Dodo Product IDs are display/routing data only in native sources', () => {
  assert.equal((swiftSources.match(/dodoProductId/gu) ?? []).length, 1,
    'native code may decode Product ID but must never use it to derive entitlement');
  assert.match(models, /let dodoProductId: String/u);
  assert.doesNotMatch(studioModel, /dodoProductId/u);
  assert.doesNotMatch(views, /dodoProductId/u);
});

test('schema-driven native preview renders the three Agent projections locally without an execution path', () => {
  assert.match(views, /AgentSkinPreview\(\s*profile: draft,\s*schema: schema,\s*client: selectedClient,\s*freeBrand: model\.freeBrand/u);
  assert.match(skinPreview, /struct AgentSkinPreview: View/u);
  assert.match(skinPreview, /for field in schema\.fields \?\? \[\]/u);
  assert.match(skinPreview, /for field in schema\.editorProjection\.fields/u);
  assert.match(skinPreview, /func value\(for fieldID: String\) -> JSONValue\?/u);
  assert.match(skinPreview, /profile\.values\[fieldID\] \?\? schemaDefaults\[fieldID\]/u);

  // WorkBuddy: full-window treatment, free-brand priority, navigation,
  // project hero, and both runtime control states.
  for (const fieldId of [
    'brand.enabled', 'brand.displayName', 'brand.shortMark', 'brand.logoStyle', 'brand.iconImage',
    'workbuddy.projectHero.image', 'workbuddy.projectHero.fit', 'workbuddy.projectHero.position',
  ]) assert.ok(skinPreview.includes(`"${fieldId}"`), `missing WorkBuddy preview field ${fieldId}`);
  for (const tab of ['新建任务', '项目', '历史']) assert.ok(skinPreview.includes(`"${tab}"`));
  assert.match(skinPreview, /PreviewActionButton\(title: "停止"/u);
  assert.match(skinPreview, /PreviewActionButton\(title: "发送"/u);
  assert.match(skinPreview, /free WorkBuddy brand wins/u);

  // Codex: a representative local candidate board must clearly preserve its
  // non-injection truth, while showing all banner knobs and core chrome.
  for (const fieldId of [
    'codex.codeThemeId', 'codex.banner.enabled', 'codex.banner.image', 'codex.banner.opacity',
    'codex.banner.height', 'codex.banner.width', 'codex.banner.position', 'layout.sidebarWidth',
  ]) assert.ok(skinPreview.includes(`"${fieldId}"`), `missing Codex preview field ${fieldId}`);
  assert.match(skinPreview, /候选 Banner · 仅本地预览/u);
  assert.match(skinPreview, /给 Codex 发送消息/u);

  // Doubao remains a design-only board until an independently verified
  // runtime adapter exists; it cannot masquerade as a live skin.
  for (const fieldId of [
    'doubao.homeHero.image', 'doubao.homeHero.fit', 'doubao.homeHero.position',
    'doubao.assistantAvatar.image', 'doubao.assistantAvatar.fit', 'doubao.assistantAvatar.shape',
  ]) assert.ok(skinPreview.includes(`"${fieldId}"`), `missing Doubao preview field ${fieldId}`);
  assert.match(skinPreview, /仅设计草图：未启动、未连接、未注入豆包/u);
  assert.match(skinPreview, /不会向豆包发送任何内容/u);

  assert.match(skinPreview, /LocalImageAsset\.previewImage/u);
  assert.doesNotMatch(skinPreview, /URLSession|URLRequest|WebSocket|CDPClient|Runtime\.evaluate|Process\(|NSWorkspace|BackendClient/u,
    'preview code must remain a pure local representation, not an Agent control path');
});

test('native Codex official-theme export is persisted-only, clipboard-only, and manually imported', () => {
  assert.match(models, /struct CodexOfficialThemeExportResponse: Decodable/u);
  assert.match(models, /let themeString: String/u);
  assert.match(models, /let manualImport: Bool/u);
  assert.match(backend, /func codexOfficialTheme\(for profile: UnionProfile\)/u);
  assert.match(backend, /\/api\/union-profiles\/\\\(profile\.id\)\/codex-official-theme/u);
  assert.match(studioModel, /func exportCodexOfficialTheme\(for profile: UnionProfile\)/u);
  assert.match(studioModel, /请先保存这套 Codex 自定义皮肤的最新修改；未保存草稿不能导出官方主题/u);
  assert.match(studioModel, /exported\.themeString\.hasPrefix\("codex-theme-v1:"\)/u);
  assert.match(views, /private var codexOfficialThemeCard: some View/u);
  assert.match(views, /复制官方主题字符串/u);
  assert.match(views, /请先点击“仅保存”，再复制这套已保存的 Codex 自定义皮肤/u);
  assert.match(views, /NSPasteboard\.general/u);
  assert.match(views, /Codex 的“设置 → 外观 → Theme”中手动导入/u);

  const exportMethod = studioModel.slice(
    studioModel.indexOf('func exportCodexOfficialTheme(for profile: UnionProfile)'),
    studioModel.indexOf('/// A design-only draft may become an executable profile'),
  );
  assert.doesNotMatch(exportMethod, /createIntent|confirm\(|launchStock|quitClientGracefully|PipeTransport|Runtime\.evaluate/u,
    'official theme export must not gain a target Agent execution path');
});

test('native desktop window exposes the same local SwiftUI root and opens on launch', () => {
  assert.match(appMain, /application\.setActivationPolicy\(\.regular\)/u);
  assert.match(appMain, /DispatchQueue\.main\.async \{ \[weak self\] in\s*self\?\.showMainWindow\(\)/u);
  assert.match(appMain, /private func showMainWindow\(\)/u);
  assert.match(appMain, /NSHostingView\(rootView: StudioRootView\(model: model\)\)/u);
  assert.match(appMain, /lingglow\.main-window/u);
  const mainWindowMethod = appMain.slice(
    appMain.indexOf('private func showMainWindow'),
    appMain.indexOf('private func observeReminders'),
  );
  assert.doesNotMatch(mainWindowMethod, /launchStock|quitClientGracefully|PipeTransport|Runtime\.evaluate|confirm\(/u,
    'opening the desktop shell must not create a target-Agent control path');
});

test('menu-bar entry opens the persistent desktop window and keeps a right-click status menu', () => {
  assert.match(appMain, /button\.sendAction\(on: \[\.leftMouseUp, \.rightMouseUp\]\)/u);
  assert.match(appMain, /if event\.type == \.rightMouseUp \{\s*showStatusMenu\(\)/u);
  assert.match(appMain, /if event\.modifierFlags\.contains\(\.control\)/u);
  assert.match(appMain, /showMainWindow\(\)/u);
  assert.match(appMain, /if let mainWindow \{\s*mainWindow\.makeKeyAndOrderFront\(nil\)/u);
  assert.match(appMain, /NSApp\.activate\(ignoringOtherApps: true\)/u);
  assert.doesNotMatch(appMain, /NSPopover/u);
});
