import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const views = await readFile(new URL('../native/Sources/Views.swift', import.meta.url), 'utf8');
const model = await readFile(new URL('../native/Sources/StudioModel.swift', import.meta.url), 'utf8');
const toolbar = views.slice(
  views.indexOf('private var catalogToolbar'),
  views.indexOf('private var availableCategories'),
);
const summaryStrip = views.slice(
  views.indexOf('private var catalogSummaryStrip'),
  views.indexOf('private var emptyCatalogMessage'),
);

test('catalog navigation and filters use the shared LingGlow control language', () => {
  assert.match(views, /private struct CatalogFilterMenu: View/u);
  assert.match(views, /private struct CatalogSegmentedControl<Option: Hashable>: View/u);
  assert.match(views, /LinearGradient\(\s*colors: \[LingGlowPalette\.accent, LingGlowPalette\.berry\]/u);
  assert.match(views, /\.onHover \{ hovering in\s*hoveredClient/u);
  assert.match(toolbar, /ViewThatFits\(in: \.horizontal\)/u);
  assert.match(toolbar, /CatalogFilterMenu\(/u);
  assert.match(toolbar, /CatalogSegmentedControl\(/u);
  assert.doesNotMatch(toolbar, /\bPicker\(/u);
  assert.doesNotMatch(toolbar, /pickerStyle\(\.segmented\)/u);
});

test('skin catalog keeps controls and status summaries compact while wrapping at narrow widths', () => {
  assert.match(toolbar, /ViewThatFits\(in: \.horizontal\)[\s\S]{0,240}ClientPicker\([\s\S]{0,180}showsHint: false,[\s\S]{0,80}compact: true/u);
  assert.match(toolbar, /ClientPicker\([\s\S]{0,260}catalogSearchField/u,
    'Agent selection and search should share the first toolbar row when space allows');
  assert.match(toolbar, /\.frame\(height: 36\)/u);

  assert.match(summaryStrip, /responsiveSummaryStrip[\s\S]{0,520}HStack\(spacing: 10\) \{\s*clientSummary\s*freeBrandSummary\s*notice\(\)/u);
  assert.match(summaryStrip, /VStack\(spacing: 10\) \{\s*pairedAppearanceSummaries\s*notice\(\)/u,
    'compatibility status should move below the paired summaries when the window narrows');
  assert.match(summaryStrip, /pairedAppearanceSummaries[\s\S]{0,360}ViewThatFits\(in: \.horizontal\)[\s\S]{0,300}VStack\(spacing: 10\)/u,
    'current skin and free appearance summaries should also stack at very narrow widths');
  assert.match(summaryStrip, /\.lineLimit\(2\)/u);
  assert.match(views, /static let compactSummaryHeight: CGFloat = 68/u);
  assert.match(views, /static let compactCardPadding: CGFloat = 10/u);
});

test('recommended shelf follows catalog metadata instead of recommending every Baxian skin', () => {
  assert.match(views, /\(skin\.tags \?\? \[\]\)\.contains\("featured"\)/u);
  assert.doesNotMatch(views, /skin\.id\.hasPrefix\("baxian-"\)/u);
});

test('skin gallery keeps compatibility warnings actionable and updates every pending skin with one action', () => {
  const skinCard = views.slice(views.indexOf('private struct SkinCard'), views.indexOf('private struct CachedLocalArtwork'));
  const canApply = views.slice(views.indexOf('private func canApply(_ skin: CatalogSkin)'), views.indexOf('private func download(_ skin: CatalogSkin)'));
  assert.match(canApply, /guard !model\.isBusy,\s*skin\.isInstalled else \{ return false \}/u);
  assert.match(canApply, /return model\.canUse\(skin\)/u);
  assert.doesNotMatch(canApply, /selectedStatus|advancedAllowed|compatibility/u,
    'compatibility must never participate in the gallery apply gate');
  assert.doesNotMatch(skinCard, /Label\("Agent 未就绪"/u);
  assert.doesNotMatch(skinCard, /safetyBlocked/u);
  assert.match(skinCard, /皮肤可应用 · .*可能存在适配问题，未适配能力会自动降级/u);
  assert.match(skinCard, /busy \|\|\s*\(skin\.isInstalled && !locked && !canApply\)/u);
  assert.doesNotMatch(skinCard, /busy \|\| active/u,
    'an active theme must stay actionable so it can be applied to another Agent');
  assert.match(skinCard, /Label\("应用到…", systemImage: "checkmark"\)/u);
  assert.doesNotMatch(skinCard, /仅设计预览/u);
  assert.doesNotMatch(skinCard, /Image\(systemName: "shield\.lefthalf\.filled"\)/u);
  assert.match(views, /兼容状态不会锁定皮肤/u);
  assert.match(views, /存在兼容或安装问题，仍可尝试应用/u);
  assert.match(views, /locked: !model\.canUse\(skin\)/u);
  assert.match(views, /if !model\.canUse\(skin\) \{\s*unlockingSkin = skin\s*\} else if skin\.needsDownloadOrUpdate \{\s*download\(skin\)\s*\} else \{\s*applyingSkin = skin/u,
    'a locked theme must open its own unlock flow before download or apply');
  assert.match(skinCard, /Label\("解锁", systemImage: "lock\.open\.fill"\)/u);
  assert.match(views, /Task \{ await model\.refreshDoctor\(\) \}/u);
  assert.match(toolbar, /Task \{ await model\.updateAllRemoteSkins\(for: model\.selectedClient\) \}/u);
  assert.match(toolbar, /更新全部（%lld）/u);
  assert.match(toolbar, /正在更新 %lld\/%lld/u);

  const batch = model.slice(
    model.indexOf('func updateAllRemoteSkins(for client: ClientID)'),
    model.indexOf('func connectAndRefresh()'),
  );
  assert.match(batch, /guard !isBusy else \{ return \}/u);
  assert.match(batch, /seenIds\.insert\(skin\.id\)\.inserted/u);
  assert.match(batch, /for skin in updates \{[\s\S]*await connected\.installRemoteSkin\(skin\.id, for: client\)/u);
  assert.doesNotMatch(batch, /TaskGroup|async let/u);
  assert.match(batch, /batchSkinUpdateCompleted \+= 1/u);
  assert.match(batch, /failedNames\.isEmpty/u);
  assert.match(batch, /可单独重试失败项目/u);
});
