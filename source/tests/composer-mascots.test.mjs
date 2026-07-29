import assert from 'node:assert/strict';
import test from 'node:test';
import {listBuiltInSkins, materializeCatalogProfile} from '../src/catalog.mjs';
import {
  listRegisteredThemePacks,
  materializeThemePack,
  projectThemePackValues,
} from '../src/catalog/theme-pack.mjs';
import {mergeFreeBrandOverride} from '../src/profile.mjs';
import {compileSkin} from '../src/skin.mjs';

test('all bundled skins materialize one validated transparent shared composer mascot', () => {
  const legacy = listBuiltInSkins({clientId: 'workbuddy'}).map((skin) => ({
    id: skin.id,
    profile: materializeCatalogProfile(skin, {clientId: 'workbuddy'}),
  }));
  const packs = listRegisteredThemePacks({clientId: 'workbuddy'}).map((pack) => ({
    id: pack.id,
    profile: materializeThemePack(pack, 'workbuddy'),
  }));
  const all = [...legacy, ...packs];
  const safeMotions = new Set(['still', 'float', 'walk', 'roll', 'crawl', 'hop']);
  assert.equal(all.length, 39);
  for (const {id, profile} of all) {
    assert.match(
      profile.advanced.workbuddy.composerAvatar.image,
      /^data:image\/webp;base64,/u,
      `${id} must materialize a validated local mascot`,
    );
    assert.equal(profile.advanced.workbuddy.composerAvatar.fit, 'contain', id);
    assert.equal(profile.advanced.workbuddy.composerAvatar.shape, 'square', id);
    assert.ok(
      safeMotions.has(profile.advanced.workbuddy.composerAvatar.activityMotion),
      `${id} must materialize a safe mascot motion`,
    );
  }
});

test('every Theme Pack projects its one mascot asset to every declared Agent', () => {
  for (const pack of listRegisteredThemePacks({clientId: 'workbuddy'})) {
    assert.equal(
      Object.hasOwn(pack.base, 'workbuddy.composerAvatar.activityMotion'),
      true,
      `${pack.id} must own its motion instead of inheriting one global effect`,
    );
    assert.equal(
      Object.values(pack.assets).filter((asset) => asset.slot === 'workbuddy.composer-avatar').length,
      1,
      pack.id,
    );
    for (const clientId of pack.clientIds) {
      const projection = projectThemePackValues(pack, clientId);
      assert.ok(
        projection.values['workbuddy.composerAvatar.image'],
        `${pack.id}/${clientId} must retain the shared mascot field`,
      );
    }
  }
});

test('the Baxian ensemble boat uses low-cost motion on every Agent', () => {
  const pack = listRegisteredThemePacks({clientId: 'doubao'})
    .find((entry) => entry.id === 'baxian-ensemble');
  assert.ok(pack);
  for (const clientId of ['workbuddy', 'codex', 'doubao']) {
    const profile = materializeThemePack(pack, clientId);
    assert.equal(
      profile.advanced.workbuddy.composerAvatar.activityMotion,
      'float',
      `${clientId} must not silently turn the Baxian boat into a still decoration`,
    );
    const compiled = compileSkin(profile, {
      clientId,
      capabilityLevel: clientId === 'workbuddy' ? 'exact' : 'generic-safe',
      capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
    });
    assert.match(compiled.css, /@keyframes lingglow-composer-float/u, clientId);
    assert.match(compiled.css, /data-lingglow-agent-active="true"/u, clientId);
  }
});

test('an installed legacy Theme Pack without a motion field remains usable', () => {
  const legacyPack = structuredClone(
    listRegisteredThemePacks({clientId: 'workbuddy'})
      .find((entry) => entry.id === 'agent-codex-terminal-orbit'),
  );
  delete legacyPack.base['workbuddy.composerAvatar.activityMotion'];
  const profile = materializeThemePack(legacyPack, 'workbuddy');
  assert.equal(profile.advanced.workbuddy.composerAvatar.activityMotion, 'roll');
});

test('one skin compiles route-aware composer mascot anchors for all three Agents', () => {
  const pack = listRegisteredThemePacks({clientId: 'workbuddy'})
    .find((entry) => entry.id === 'messi-argentina');
  assert.ok(pack);
  const cases = [
    ['workbuddy', /\.wb-cb-chat \[data-lingglow-workbuddy-composer="true"\]/u],
    ['codex', /data-lingglow-codex-composer-anchor="true"/u],
    ['doubao', /data-lingglow-doubao-composer="true"/u],
  ];
  for (const [clientId, anchor] of cases) {
    const materialized = materializeThemePack(pack, clientId);
    const compiled = compileSkin(materialized, {
      clientId,
      capabilityLevel: clientId === 'workbuddy' ? 'exact' : 'generic-safe',
      capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
    });
    assert.match(compiled.css, anchor, clientId);
    assert.match(compiled.css, /background-image: url\("data:image\/webp;base64,/u, clientId);
    assert.match(compiled.css, /pointer-events: none !important/u, clientId);
    assert.match(compiled.css, /animation: lingglow-composer-float 8\.2s linear infinite both !important/u, clientId);
    assert.match(compiled.css, /animation-play-state: paused !important/u, clientId);
    assert.match(compiled.css, /data-lingglow-agent-active="true"/u, clientId);
    assert.match(compiled.css,
      /data-lingglow-agent-active="true"[\s\S]*?animation-play-state: running !important/u,
      clientId);
    assert.match(compiled.css, /@media \(prefers-reduced-motion: reduce\)/u, clientId);
    assert.equal(compiled.audit.composerAvatarEnabled, true, clientId);
    assert.equal(compiled.audit.localImagesEmbedded, true, clientId);
    assert.ok(compiled.audit.runtimeConsumedFieldIds.includes('workbuddy.composerAvatar.image'));
    assert.ok(compiled.audit.runtimeConsumedFieldIds.includes('workbuddy.composerAvatar.activityMotion'));
    if (clientId === 'workbuddy') {
      assert.match(compiled.css, /data-lingglow-workbuddy-landing-composer="true"/u);
      assert.match(compiled.css,
        /data-lingglow-workbuddy-landing-composer="true"\]::after \{[\s\S]*?right: 18px !important;[\s\S]*?animation: none !important/u);
    }
  }
});

test('all three Agents traverse the composer and turn around for every safe static-image motion', () => {
  const pack = listRegisteredThemePacks({clientId: 'workbuddy'})
    .find((entry) => entry.clientIds.length === 3);
  const expected = new Map([
    ['float', /@keyframes lingglow-composer-float/u],
    ['walk', /@keyframes lingglow-composer-walk/u],
    ['roll', /@keyframes lingglow-composer-roll/u],
    ['crawl', /@keyframes lingglow-composer-crawl/u],
    ['hop', /@keyframes lingglow-composer-hop/u],
  ]);
  for (const clientId of ['workbuddy', 'codex', 'doubao']) {
    const top = clientId === 'workbuddy' ? -58 : -64;
    for (const [motion, keyframes] of expected) {
      const profile = structuredClone(materializeThemePack(pack, clientId));
      profile.advanced.workbuddy.composerAvatar.activityMotion = motion;
      const compiled = compileSkin(profile, {
        clientId,
        capabilityLevel: clientId === 'workbuddy' ? 'exact' : 'generic-safe',
        capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
      });
      const label = `${clientId}/${motion}`;
      assert.match(compiled.css, keyframes, label);
      assert.match(compiled.css, /animation-play-state: paused !important/u,
        `${label} must stay idle until the Agent exposes a real stop control`);
      assert.match(compiled.css, /data-lingglow-agent-active="true"/u,
        `${label} must run only while the Agent is generating`);
      assert.match(compiled.css, /--lingglow-mascot-travel-x/u,
        `${label} must cross the measured composer width`);
      assert.match(compiled.css, /translate3d\(var\(--lingglow-mascot-travel-x, -240px\)/u,
        `${label} must use compositor-only horizontal travel`);
      const keyframeStart = compiled.css.indexOf(`@keyframes lingglow-composer-${motion}`);
      const keyframeEnd = compiled.css.indexOf('@media (prefers-reduced-motion: reduce)', keyframeStart);
      const keyframeCss = compiled.css.slice(keyframeStart, keyframeEnd);
      assert.doesNotMatch(keyframeCss, /right:/u,
        `${label} keyframes must not animate the layout-triggering right property`);
      assert.match(compiled.css, /will-change: transform !important/u,
        `${label} may promote only the transform while active`);
      assert.doesNotMatch(compiled.css, /will-change: right, transform/u,
        `${label} must not promote a layout property`);
      if (motion === 'roll') {
        assert.match(compiled.css,
          /49%[\s\S]*?rotate\(-720deg\)[\s\S]*?51%[\s\S]*?rotate\(-720deg\)[\s\S]*?100%[\s\S]*?rotate\(0deg\)/u,
          `${label} must reverse its rotation while returning`);
        assert.doesNotMatch(compiled.css,
          /@keyframes lingglow-composer-roll[\s\S]*?scaleX\(/u,
          `${label} roll must not mirror its rotation coordinate system`);
      } else {
        assert.match(compiled.css, /49\.9%[\s\S]*?scaleX\(-1\)[\s\S]*?50\.1%[\s\S]*?scaleX\(1\)/u,
          `${label} must turn around at the far edge`);
      }
      assert.match(compiled.css, new RegExp(`top: ${top}px !important;\\s+right: 18px !important;\\s+z-index`, 'u'),
        `${label} base position must stay fixed while transform handles travel`);
    }
  }
  const still = structuredClone(materializeThemePack(pack, 'codex'));
  still.advanced.workbuddy.composerAvatar.activityMotion = 'still';
  const compiledStill = compileSkin(still, {
    clientId: 'codex',
    capabilityLevel: 'generic-safe',
    capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
  });
  assert.doesNotMatch(compiledStill.css, /@keyframes lingglow-composer-(?:float|walk|roll|crawl|hop)/u);
  assert.doesNotMatch(compiledStill.css, /data-lingglow-agent-active/u);
  assert.match(compiledStill.css, /top: -64px !important;\s+right: 18px !important;\s+z-index/u);
});

test('free mascot image follows the selected Agent without overwriting its Theme Pack motion', () => {
  const base = materializeThemePack(
    listRegisteredThemePacks({clientId: 'workbuddy'}).find((entry) => entry.clientIds.length === 3),
    'workbuddy',
  );
  const override = {
    composerAvatarImage: base.advanced.workbuddy.composerAvatar.image,
    composerAvatarMotion: 'crawl',
  };
  for (const clientId of ['workbuddy', 'codex', 'doubao']) {
    const merged = mergeFreeBrandOverride({...base, id: `override-${clientId}`}, override, {clientId});
    assert.equal(
      merged.advanced.workbuddy.composerAvatar.image,
      override.composerAvatarImage,
      clientId,
    );
    assert.equal(
      merged.advanced.workbuddy.composerAvatar.activityMotion,
      base.advanced.workbuddy.composerAvatar.activityMotion,
      clientId,
    );
  }
});
