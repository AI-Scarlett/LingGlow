import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_FIELD_CONSUMPTION,
  CODEX_OFFICIAL_THEME_FIELD_IDS,
  CLIENT_CAPABILITY_MAPS,
  CODEX_CAPABILITY_MAP,
  DOUBAO_CAPABILITY_MAP,
  FIELD_CONSUMPTION_KINDS,
  SUPPORT_STATUSES,
  UNION_CLIENT_IDS,
  UNION_FIELDS,
  UNION_SCHEMA_VERSION,
  WORKBUDDY_CAPABILITY_MAP,
  compileUnionProfileForClient,
  compilerConsumptionAudit,
  createUnionProfile,
  getFieldConsumptionForClient,
  getClientCapabilityMap,
  getEditorFieldsForClient,
  getUnionField,
  normalizeUnionProfile,
  updateUnionProfileValues,
} from '../src/capability-schema.mjs';
import {normalizeProfile, officialThemeObject} from '../src/profile.mjs';

const onePixelWebp = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89';

test('union schema has stable metadata, all three clients, and explicit asset slots', () => {
  assert.equal(UNION_SCHEMA_VERSION, 1);
  assert.deepEqual(UNION_CLIENT_IDS, ['workbuddy', 'doubao', 'codex']);
  assert.equal(new Set(UNION_FIELDS.map((field) => field.id)).size, UNION_FIELDS.length);
  assert.ok(UNION_FIELDS.length >= 40);
  for (const field of UNION_FIELDS) {
    assert.match(field.id, /^[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/u);
    assert.ok(['boolean', 'string', 'color', 'number', 'integer', 'enum', 'asset'].includes(field.type));
    assert.ok(['stable', 'candidate'].includes(field.status));
    assert.equal(field.version, 1);
    assert.equal(typeof field.description, 'string');
    assert.ok(field.description.length > 0);
    assert.ok(field.clients.length >= 1 && field.clients.length <= UNION_CLIENT_IDS.length);
    assert.equal(field.type === 'asset', typeof field.assetSlot === 'string');
  }
  assert.ok(UNION_FIELDS.some((field) => field.clients.length === 1));
  assert.ok(UNION_FIELDS.some((field) => field.clients.length === 2));
  assert.ok(UNION_FIELDS.some((field) => field.clients.length === UNION_CLIENT_IDS.length));
  assert.equal(getUnionField('background.image').assetSlot, 'background.main');
  assert.equal(getUnionField('brand.iconImage').assetSlot, 'brand.icon');
  assert.equal(getUnionField('workbuddy.projectHero.image').assetSlot, 'workbuddy.project-hero');
  assert.equal(getUnionField('doubao.homeHero.image').status, 'candidate');
  assert.equal(getUnionField('missing.future.field'), null);
});

test('each client has a complete, separate versioned capability map', () => {
  assert.deepEqual(Object.keys(CLIENT_CAPABILITY_MAPS), UNION_CLIENT_IDS);
  assert.equal(CLIENT_CAPABILITY_MAPS.workbuddy, WORKBUDDY_CAPABILITY_MAP);
  assert.equal(CLIENT_CAPABILITY_MAPS.doubao, DOUBAO_CAPABILITY_MAP);
  assert.equal(CLIENT_CAPABILITY_MAPS.codex, CODEX_CAPABILITY_MAP);
  for (const clientId of UNION_CLIENT_IDS) {
    const map = getClientCapabilityMap(clientId);
    assert.equal(map.clientId, clientId);
    assert.equal(map.version, 1);
    const applicable = UNION_FIELDS.filter((field) => field.clients.includes(clientId)).map((field) => field.id);
    assert.deepEqual(Object.keys(map.fields), applicable);
    for (const support of Object.values(map.fields)) {
      assert.ok(SUPPORT_STATUSES.includes(support.status));
      assert.equal(support.version, 1);
      assert.equal(typeof support.description, 'string');
      assert.equal(typeof support.capability, 'string');
    }
  }
  assert.equal(CLIENT_CAPABILITY_MAPS.workbuddy.fields['workbuddy.projectHero.image'].status, 'supported');
  assert.equal(CLIENT_CAPABILITY_MAPS.workbuddy.fields['layout.sidebarWidth'].status, 'unsupported');
  assert.equal(CLIENT_CAPABILITY_MAPS.codex.fields['shape.radius'].status, 'pending');
  assert.equal(CLIENT_CAPABILITY_MAPS.codex.fields['codex.banner.image'].status, 'pending');
  assert.equal(CLIENT_CAPABILITY_MAPS.doubao.fields['doubao.homeHero.image'].status, 'pending');
  assert.match(CLIENT_CAPABILITY_MAPS.doubao.auditedTarget, /2\.19\.9 exact/u);
  assert.equal(CLIENT_CAPABILITY_MAPS.doubao.fields['appearance.accent'].status, 'supported');
  assert.equal(CLIENT_CAPABILITY_MAPS.doubao.fields['background.image'].status, 'supported');
  assert.equal(CLIENT_CAPABILITY_MAPS.doubao.runtimeStatus, 'available');
  assert.equal(CLIENT_CAPABILITY_MAPS.doubao.transportVerified, true);
  assert.deepEqual(CLIENT_CAPABILITY_MAPS.doubao.capabilities, [
    'background', 'palette', 'glass', 'composer-avatar',
  ]);
  for (const clientId of UNION_CLIENT_IDS) {
    assert.equal(
      CLIENT_CAPABILITY_MAPS[clientId].fields['workbuddy.composerAvatar.image'].status,
      'supported',
      `${clientId} must expose the shared composer mascot`,
    );
  }
  assert.throws(() => getClientCapabilityMap('unknown'), /未知并集客户端/u);
});

test('every supported field has a truthful runtime or manual official-theme consumer', () => {
  for (const clientId of UNION_CLIENT_IDS) {
    const capabilityMap = CLIENT_CAPABILITY_MAPS[clientId];
    const supportedIds = Object.values(capabilityMap.fields)
      .filter((field) => field.status === 'supported')
      .map((field) => field.fieldId)
      .sort();
    const contractIds = Object.keys(CLIENT_FIELD_CONSUMPTION[clientId]).sort();
    assert.deepEqual(contractIds, supportedIds, `${clientId} support map and consumer contract drifted`);

    for (const fieldId of supportedIds) {
      const consumers = getFieldConsumptionForClient(clientId, fieldId);
      assert.ok(consumers.length > 0, `${clientId}/${fieldId} must not be storage-only`);
      assert.equal(capabilityMap.fields[fieldId].consumption, consumers,
        'API capability-map entries must expose the canonical immutable contract');
      for (const consumer of consumers) {
        assert.ok(FIELD_CONSUMPTION_KINDS.includes(consumer.kind));
        assert.equal(typeof consumer.consumer, 'string');
        assert.ok(Array.isArray(consumer.requiredCapabilities));
        if (consumer.kind === 'manual-official-import') {
          assert.equal(clientId, 'codex');
          assert.equal(consumer.consumer, 'codex-theme-v1');
          assert.ok(CODEX_OFFICIAL_THEME_FIELD_IDS.includes(fieldId));
        }
      }
    }
  }

  assert.deepEqual(CODEX_OFFICIAL_THEME_FIELD_IDS, [
    'appearance.variant', 'appearance.accent', 'appearance.surface', 'appearance.ink', 'appearance.contrast',
    'typography.codeFont', 'typography.uiFont', 'window.opaque',
    'semantic.diffAdded', 'semantic.diffRemoved', 'semantic.skill', 'codex.codeThemeId',
  ]);
  assert.equal(getFieldConsumptionForClient('codex', 'typography.codeFont')[0].kind, 'manual-official-import');
  assert.equal(getFieldConsumptionForClient('workbuddy', 'typography.codeFont').length, 0);
});

test('compiler consumption audit mirrors generic-safe, exact, and stock-safe delivery paths', () => {
  const codexGeneric = compilerConsumptionAudit('codex', {
    enabledCapabilities: ['background', 'palette', 'glass', 'composer-avatar'],
    visualLayerEnabled: true,
  });
  assert.ok(codexGeneric.runtimeFieldIds.includes('background.image'));
  assert.ok(codexGeneric.runtimeFieldIds.includes('glass.blur'));
  assert.ok(codexGeneric.runtimeFieldIds.includes('appearance.accent'));
  assert.ok(codexGeneric.runtimeFieldIds.includes('workbuddy.composerAvatar.image'));
  assert.equal(codexGeneric.runtimeFieldIds.includes('typography.codeFont'), false);
  assert.deepEqual(codexGeneric.manualOfficialImportFieldIds, [...CODEX_OFFICIAL_THEME_FIELD_IDS].sort());
  assert.deepEqual(codexGeneric.visualLayerGateFieldIds, ['advanced.enabled']);

  const stockSafe = compilerConsumptionAudit('codex', {
    enabledCapabilities: ['background', 'palette', 'glass'],
    visualLayerEnabled: false,
  });
  assert.deepEqual(stockSafe.runtimeFieldIds, []);
  assert.deepEqual(stockSafe.visualLayerGateFieldIds, ['advanced.enabled']);
  assert.deepEqual(stockSafe.manualOfficialImportFieldIds, [...CODEX_OFFICIAL_THEME_FIELD_IDS].sort(),
    'disabling the visual layer must not erase the separately manual official-theme export');

  const workbuddyExact = compilerConsumptionAudit('workbuddy', {
    enabledCapabilities: ['background', 'palette', 'glass', 'brand', 'navigation', 'controls', 'project-hero'],
    visualLayerEnabled: true,
  });
  for (const fieldId of [
    'brand.displayName', 'semantic.diffRemoved', 'shape.radius',
    'workbuddy.projectHero.image', 'workbuddy.projectHero.fit', 'workbuddy.projectHero.position',
  ]) assert.ok(workbuddyExact.runtimeFieldIds.includes(fieldId));
  assert.deepEqual(workbuddyExact.manualOfficialImportFieldIds, []);
});

test('manual official-theme contract payload paths resolve in the actual Codex export object', () => {
  const theme = officialThemeObject(normalizeProfile({
    official: {
      variant: 'light', accent: '#123456', surface: '#F0F0F0', ink: '#102030', contrast: 61,
      fonts: {code: 'JetBrains Mono', ui: 'Inter'}, opaqueWindows: false,
      semanticColors: {diffAdded: '#12AB34', diffRemoved: '#CD3456', skill: '#7654DC'},
      codeThemeId: 'dracula',
    },
  }));
  const valueAtPath = (object, dottedPath) => dottedPath.split('.').reduce(
    (current, segment) => current?.[segment],
    object,
  );
  const manualEntries = Object.entries(CLIENT_FIELD_CONSUMPTION.codex)
    .flatMap(([fieldId, consumers]) => consumers
      .filter((consumer) => consumer.kind === 'manual-official-import')
      .map((consumer) => ({fieldId, ...consumer})));
  assert.deepEqual(manualEntries.map((entry) => entry.fieldId), CODEX_OFFICIAL_THEME_FIELD_IDS);
  for (const entry of manualEntries) {
    assert.notEqual(valueAtPath(theme, entry.payloadPath), undefined,
      `${entry.fieldId} must resolve in codex-theme-v1 at ${entry.payloadPath}`);
  }
});

test('editor fields are client-specific and expose support state without dropping defaults', () => {
  const workbuddy = getEditorFieldsForClient('workbuddy');
  assert.ok(workbuddy.some((field) => field.id === 'appearance.accent' && field.editable));
  assert.ok(workbuddy.some((field) => field.id === 'layout.sidebarWidth' && field.supportStatus === 'unsupported'));
  assert.ok(workbuddy.some((field) => field.id === 'workbuddy.projectHero.image'));
  assert.equal(workbuddy.some((field) => field.id.startsWith('codex.')), false);
  assert.equal(workbuddy.some((field) => field.id.startsWith('doubao.')), false);
  assert.equal(workbuddy.find((field) => field.id === 'appearance.accent').value, '#7AA2F7');
  assert.equal(workbuddy.find((field) => field.id === 'appearance.accent').usesDefault, true);

  const supportedOnly = getEditorFieldsForClient('workbuddy', {includeStatuses: ['supported']});
  assert.ok(supportedOnly.length > 0);
  assert.ok(supportedOnly.every((field) => field.editable && field.supportStatus === 'supported'));
  const doubaoSupported = getEditorFieldsForClient('doubao', {includeStatuses: ['supported']});
  assert.ok(doubaoSupported.length > 0);
  assert.ok(doubaoSupported.every((field) => field.editable && field.supportStatus === 'supported'));
  assert.ok(doubaoSupported.some((field) => field.id === 'appearance.accent'));
  assert.ok(doubaoSupported.some((field) => field.id === 'background.image'));
  assert.ok(doubaoSupported.some((field) => field.id === 'glass.enabled'));
  const doubaoAll = getEditorFieldsForClient('doubao');
  assert.ok(doubaoAll.some((field) => field.id === 'doubao.assistantAvatar.image'));
  assert.ok(doubaoAll.some((field) => field.id === 'doubao.assistantAvatar.image' && field.supportStatus === 'pending'));
  assert.ok(doubaoAll.some((field) => field.id === 'appearance.accent' && field.supportStatus === 'supported'));
  assert.throws(
    () => getEditorFieldsForClient('codex', {includeStatuses: ['future']}),
    /未知支持状态/u,
  );
});

test('client compilation consumes supported fields only', () => {
  const profile = normalizeUnionProfile({
    schemaVersion: 1,
    profileId: 'multi-client-demo',
    values: {
      'appearance.accent': '#E25563',
      'appearance.variant': 'light',
      'shape.radius': 24,
      'background.image': onePixelWebp,
      'brand.displayName': 'Union Demo',
      'workbuddy.projectHero.position': 'right',
      'codex.banner.height': 180,
      'doubao.homeHero.position': 'top right',
      'future.sparkle.strength': {mode: 'adaptive', value: 0.8},
    },
  });

  const workbuddy = compileUnionProfileForClient(profile, 'workbuddy');
  assert.equal(workbuddy.values['appearance.accent'], '#E25563');
  assert.equal(workbuddy.values['background.image'], onePixelWebp);
  assert.equal(workbuddy.values['brand.displayName'], 'Union Demo');
  assert.equal(workbuddy.values['workbuddy.projectHero.position'], 'right');
  assert.equal(Object.hasOwn(workbuddy.values, 'appearance.variant'), false);
  assert.equal(Object.hasOwn(workbuddy.values, 'codex.banner.height'), false);
  assert.equal(Object.hasOwn(workbuddy.values, 'doubao.homeHero.position'), false);
  assert.equal(Object.hasOwn(workbuddy.values, 'future.sparkle.strength'), false);

  const codex = compileUnionProfileForClient(profile, 'codex');
  assert.equal(codex.values['appearance.accent'], '#E25563');
  assert.equal(codex.values['appearance.variant'], 'light');
  assert.equal(codex.values['codex.codeThemeId'], 'codex');
  assert.equal(Object.hasOwn(codex.values, 'shape.radius'), false);
  assert.equal(Object.hasOwn(codex.values, 'codex.banner.height'), false);
  assert.equal(Object.hasOwn(codex.values, 'brand.displayName'), false);
  assert.equal(Object.hasOwn(codex.values, 'workbuddy.projectHero.position'), false);

  const doubao = compileUnionProfileForClient(profile, 'doubao');
  assert.equal(doubao.values['appearance.accent'], '#E25563');
  assert.equal(doubao.values['background.image'], onePixelWebp);
  assert.equal(Object.hasOwn(doubao.values, 'doubao.homeHero.position'), false);
  assert.equal(Object.hasOwn(doubao.values, 'brand.displayName'), false);
  assert.equal(Object.hasOwn(doubao.values, 'codex.banner.height'), false);
});

test('inapplicable and unknown fields survive normalize and editor updates', () => {
  const input = {
    schemaVersion: 1,
    profileId: 'round-trip',
    futureMetadata: {authoringClient: 'v3'},
    values: {
      'appearance.accent': '#7AA2F7',
      'workbuddy.projectHero.fit': 'contain',
      'codex.banner.position': 'bottom-right',
      'doubao.assistantAvatar.shape': 'rounded',
      'future.particles': {enabled: true, stops: [0.2, 0.7]},
    },
  };
  const normalized = normalizeUnionProfile(input);
  assert.deepEqual(normalized, input);
  const updated = updateUnionProfileValues(normalized, {'appearance.accent': '#ABCDEF'});
  assert.equal(updated.values['appearance.accent'], '#ABCDEF');
  assert.equal(updated.values['workbuddy.projectHero.fit'], 'contain');
  assert.equal(updated.values['codex.banner.position'], 'bottom-right');
  assert.equal(updated.values['doubao.assistantAvatar.shape'], 'rounded');
  assert.deepEqual(updated.values['future.particles'], {enabled: true, stops: [0.2, 0.7]});
  assert.deepEqual(updated.futureMetadata, {authoringClient: 'v3'});

  const removed = updateUnionProfileValues(updated, {'codex.banner.position': undefined});
  assert.equal(Object.hasOwn(removed.values, 'codex.banner.position'), false);
  assert.equal(removed.values['workbuddy.projectHero.fit'], 'contain');
});

test('future schema values round-trip even when this runtime cannot consume their widened type', () => {
  const future = normalizeUnionProfile({
    schemaVersion: 2,
    futureTopLevel: {renderer: 'v2'},
    values: {
      'appearance.accent': {kind: 'adaptive-gradient', stops: ['#111111', '#FFFFFF']},
      'future.shader': {name: 'safe-future-value'},
    },
  });
  assert.deepEqual(future.values['appearance.accent'], {
    kind: 'adaptive-gradient',
    stops: ['#111111', '#FFFFFF'],
  });
  assert.deepEqual(future.values['future.shader'], {name: 'safe-future-value'});
  const compiled = compileUnionProfileForClient(future, 'codex');
  assert.equal(compiled.sourceSchemaVersion, 2);
  assert.equal(compiled.values['appearance.accent'], '#7AA2F7');
  assert.equal(Object.hasOwn(compiled.values, 'future.shader'), false);
  const editorAccent = getEditorFieldsForClient('codex', {profile: future})
    .find((field) => field.id === 'appearance.accent');
  assert.equal(editorAccent.sourceValueValid, false);
  assert.equal(editorAccent.usesDefault, true);
});

test('new union documents include every default and legacy profile v1 remains unchanged', () => {
  const created = createUnionProfile({profileId: 'new-union', name: 'New Union'});
  assert.equal(created.schemaVersion, 1);
  assert.equal(created.profileId, 'new-union');
  assert.equal(Object.keys(created.values).length, UNION_FIELDS.length);
  for (const descriptor of UNION_FIELDS) assert.ok(Object.hasOwn(created.values, descriptor.id));

  const legacy = normalizeProfile({id: 'legacy-v1', name: 'Legacy V1'});
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(Object.hasOwn(legacy, 'values'), false);
  assert.equal(legacy.official.accent, '#7AA2F7');

  assert.throws(
    () => normalizeUnionProfile({schemaVersion: 1, values: {'appearance.accent': 'linear-gradient(red, blue)'}}),
    /appearance\.accent/u,
  );
  assert.throws(
    () => normalizeUnionProfile({schemaVersion: 1, values: {'background.image': 'https://evil.example/bg.png'}}),
    /本地嵌入/u,
  );
  assert.throws(
    () => normalizeUnionProfile({schemaVersion: 1, values: JSON.parse('{"__proto__":{"polluted":true}}')}),
    /保留键/u,
  );
});
