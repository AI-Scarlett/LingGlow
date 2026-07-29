import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const views = await readFile(new URL('../native/Sources/Views.swift', import.meta.url), 'utf8');
const images = await readFile(new URL('../native/Sources/ImageAssets.swift', import.meta.url), 'utf8');
const model = await readFile(new URL('../native/Sources/StudioModel.swift', import.meta.url), 'utf8');
const appMain = await readFile(new URL('../native/Sources/AppMain.swift', import.meta.url), 'utf8');
const backend = await readFile(new URL('../native/Sources/Backend.swift', import.meta.url), 'utf8');

test('skin tab decodes bounded previews off the main actor and reuses them', () => {
  assert.match(views, /if let artwork = skin\.previewArtwork \{[\s\S]{0,260}CachedLocalArtwork\([\s\S]{0,120}dataURL: artwork/u);
  assert.doesNotMatch(views, /LocalImageAsset\.previewImage\(from: skin\.previewArtwork\)/u);
  assert.match(views, /previewImageAsync\([\s\S]{0,160}maximumPixelSize: 800/u);
  assert.match(images, /NSCache<NSString, NSImage>/u);
  assert.match(images, /previewDecodeQueue\.async/u);
  assert.match(images, /CGImageSourceCreateThumbnailAtIndex/u);
  assert.match(images, /kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize/u);
  assert.match(images, /totalCostLimit = 96 \* 1024 \* 1024/u);
});

test('tab changes never hash or re-decode a cached multi-megabyte Base64 preview on the main actor', () => {
  assert.match(views, /cacheID: "\\\(skin\.id\):\\\(skin\.packageVersion \?\? "bundled"\)"/u);
  const cacheLookupIndex = images.indexOf('previewCache.object');
  const base64DecodeIndex = images.indexOf('Data(base64Encoded:');
  assert.ok(cacheLookupIndex >= 0, 'preview cache lookup should exist');
  assert.ok(base64DecodeIndex > cacheLookupIndex, 'cache must be checked before Base64 decoding');
  const cacheKeyStart = images.indexOf('static func previewCacheKey');
  const cacheKeyBody = images.slice(cacheKeyStart, cacheKeyStart + 900);
  assert.ok(cacheKeyStart >= 0, 'previewCacheKey should exist');
  assert.doesNotMatch(cacheKeyBody, /hashValue|utf8\.count/u);
  assert.match(images, /guard !Task\.isCancelled else \{ return nil \}/u);
});

test('account products load independently and opening the first window does not duplicate the startup catalog refresh', () => {
  const accountView = views.slice(views.indexOf('private struct AccountView'));
  assert.match(accountView, /\.task \{\s*await model\.loadProductCatalogIfNeeded\(\)/u);
  assert.match(model, /_ = startProductCatalogLoad\(using: connected\)[\s\S]{0,240}let scheduleResponse = try await connected\.schedule\(\)[\s\S]{0,160}try await loadCatalogs/u);
  assert.match(model, /@Published var isProductCatalogLoading = false/u);
  assert.match(appMain, /if model\.connectionState == \.connected \{\s*Task \{ await model\.refreshAll\(\) \}/u);
});

test('all primary pages stay mounted, Schedule data wins startup priority, and catalog artwork is bounded', () => {
  assert.match(views, /private var cachedTabContent: some View/u);
  assert.match(views, /ZStack \{/u);
  for (const tab of ['skins', 'custom', 'schedule', 'account', 'settings']) {
    assert.match(views, new RegExp(`cachedPage\\(\\.${tab}\\)`, 'u'));
  }
  assert.match(views, /\.allowsHitTesting\(selectedTab == tab\)/u);
  assert.match(views, /\.accessibilityHidden\(selectedTab != tab\)/u);
  const snapshotStart = model.indexOf('private func loadSnapshot(using connected: LocalAPI)');
  const snapshot = model.slice(snapshotStart, snapshotStart + 2200);
  assert.ok(snapshot.indexOf('let scheduleResponse = try await connected.schedule()') <
    snapshot.indexOf('try await loadCatalogs(using: connected)'));
  assert.match(backend, /URLQueryItem\(name: "artwork", value: "summary"\)/u);
});

test('Latest is the first catalog shelf and shows the six newest publication times', () => {
  assert.match(views, /@State private var selectedShelf: CatalogShelfFilter = \.latest/u);
  const filter = views.slice(
    views.indexOf('private enum CatalogShelfFilter'),
    views.indexOf('private var catalogGrid'),
  );
  assert.ok(filter.indexOf('case latest') < filter.indexOf('case recommended'));
  assert.match(views, /case \.latest:[\s\S]{0,700}publishedAt[\s\S]{0,400}prefix\(6\)/u);
});

test('launching LingGlow activates a regular app and always opens its desktop window', () => {
  assert.match(appMain, /application\.setActivationPolicy\(\.regular\)/u);
  assert.match(appMain, /applicationDidFinishLaunching[\s\S]{0,900}DispatchQueue\.main\.async[\s\S]{0,160}showMainWindow\(\)/u);
});

test('a successful reconnect clears only the stale local-service banner', () => {
  assert.match(model, /private var errorIsConnectionFailure = false/u);
  assert.match(model, /private var consecutiveConnectionFailures = 0/u);
  assert.match(model, /private func report\(_ error: Error\)[\s\S]{0,220}registerConnectionFailure\(error, showMessage: true\)/u);
  assert.match(model, /private func registerConnectionFailure[\s\S]{0,600}connectionState = \.starting[\s\S]{0,240}无需手动连接/u);
  assert.match(model, /private func clearRecoveredConnectionError\(\)[\s\S]{0,260}consecutiveConnectionFailures = 0[\s\S]{0,160}guard errorIsConnectionFailure else \{ return \}[\s\S]{0,160}errorMessage = nil/u);
  assert.match(model, /func connectAndRefresh\(\)[\s\S]{0,720}connectionState = \.connected\s*clearRecoveredConnectionError\(\)/u);
  assert.match(model, /private func refreshStatusSilently\(\)[\s\S]{0,900}connectionState = \.connected\s*clearRecoveredConnectionError\(\)/u);
});

test('every operation rejects a stale cached backend session and reconnects automatically', () => {
  assert.match(backend, /func matchesCurrentSessionManifest\(\)[\s\S]{0,420}PrivateSessionReader\.read\(\)[\s\S]{0,260}current\.instanceId == lock\.instanceId/u);
  const connectedAPI = model.slice(
    model.indexOf('private func connectedAPI()'),
    model.indexOf('private func startProductCatalogLoad'),
  );
  assert.match(connectedAPI, /current\.matchesCurrentSessionManifest\(\)/u);
  assert.match(connectedAPI, /let liveStatus = try await current\.status\(\)/u);
  assert.match(connectedAPI, /guard isConnectionFailure\(error\) else \{ throw error \}[\s\S]{0,100}api = nil/u);
  assert.match(connectedAPI, /bootstrapper\.ensureRunning\(\)[\s\S]{0,220}connectionState = \.connected/u);
});

test('tab startup stays bounded and stale LingGlow runtimes cannot leave product loading stuck', () => {
  const scheduleView = views.slice(views.indexOf('private struct ScheduleView'), views.indexOf('private struct AccountView'));
  assert.match(scheduleView, /let scheduleSkinOptions = model\.scheduleSkinOptions\(for: model\.selectedClient\)/u);
  assert.equal((scheduleView.match(/model\.scheduleSkinOptions\(for: model\.selectedClient\)/gu) ?? []).length, 1);

  const recovery = backend.slice(backend.indexOf('private func recoverForeignRuntime'), backend.indexOf('private func isProcessAlive'));
  assert.match(recovery, /api\.shutdown\(\)[\s\S]*waitForProcessExit[\s\S]*SIGTERM[\s\S]*waitForProcessExit[\s\S]*SIGKILL/u);
  assert.match(backend, /private var startupTask: Task<LocalAPI, Error>\?/u);
  assert.match(backend, /if let startupTask \{[\s\S]{0,120}startupTask\.value/u);
  assert.match(backend, /for _ in 0\.\.<150/u);
  assert.match(model, /let needsFullSnapshot = api == nil \|\| connectionState != \.connected[\s\S]{0,260}loadSnapshot\(using: connected\)/u);
});

test('skin confirmation keeps the connection open for the verified restart window', () => {
  const confirm = backend.slice(
    backend.indexOf('func confirm(intent: ApplyIntent)'),
    backend.indexOf('func activateLicense'),
  );
  assert.match(confirm, /timeoutInterval: 120/u);
  assert.match(backend, /configuration\.timeoutIntervalForResource = 150/u);
  assert.match(model, /func confirm\(_ intent: ApplyIntent\)[\s\S]{0,700}confirmApplyWithRecovery/u,
    'single-Agent confirmation must reconcile through the same recovered session path');
});
