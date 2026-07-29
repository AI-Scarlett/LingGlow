import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  contrastRatio,
  getProfile,
  loadFreeBrand,
  mergeFreeBrandOverride,
  normalizeFreeBrand,
  normalizeProfile,
  officialThemeString,
  saveFreeBrand,
  saveProfile,
  validateImageDataUrl,
} from '../src/profile.mjs';

const onePixelWebp = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89';
const goodComposerWebp = `data:image/webp;base64,${fs.readFileSync(
  new URL('../catalog/assets/baxian-ensemble-mascot.webp', import.meta.url),
).toString('base64')}`;
const circularCropWebp = `data:image/webp;base64,${fs.readFileSync(
  new URL('../catalog/assets/agent-codex-terminal-orbit-avatar.webp', import.meta.url),
).toString('base64')}`;
const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const onePixelJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/n/ooooA/9k=';

test('normalizes a profile and emits the verified theme v1 shape', () => {
  const profile = normalizeProfile({
    id: 'night',
    name: 'Night',
    official: {accent: '#abcdef', contrast: 150, variant: 'dark'},
  });
  assert.equal(profile.official.accent, '#ABCDEF');
  assert.equal(profile.official.contrast, 100);
  assert.deepEqual(profile.advanced.brand, {
    enabled: false,
    displayName: null,
    shortMark: null,
    logoStyle: 'original',
    iconImage: null,
  });
  assert.deepEqual(profile.advanced.workbuddy, {
    homeCopy: {title: null, subtitle: null},
    projectHero: {image: null, fit: 'cover', position: 'center'},
    composerAvatar: {image: null, fit: 'contain', shape: 'square', activityMotion: 'float'},
  });
  const share = officialThemeString(profile);
  assert.ok(share.startsWith('codex-theme-v1:'));
  const parsed = JSON.parse(share.slice('codex-theme-v1:'.length));
  assert.equal(parsed.variant, 'dark');
  assert.equal(parsed.codeThemeId, 'codex');
  assert.deepEqual(Object.keys(parsed.theme).sort(), [
    'accent', 'contrast', 'fonts', 'ink', 'opaqueWindows', 'semanticColors', 'surface',
  ]);
});

test('normalizes a safe Unicode visual brand without changing the official theme payload', () => {
  const profile = normalizeProfile({
    id: 'branded',
    name: 'Branded',
    advanced: {
      brand: {
        enabled: true,
        displayName: '梦境 2.0 · AI_Co-1 & X',
        shortMark: '梦2',
        logoStyle: 'diamond',
      },
    },
  });
  assert.deepEqual(profile.advanced.brand, {
    enabled: true,
    displayName: '梦境 2.0 · AI_Co-1 & X',
    shortMark: '梦2',
    logoStyle: 'diamond',
    iconImage: null,
  });
  const official = JSON.parse(officialThemeString(profile).slice('codex-theme-v1:'.length));
  assert.equal(Object.hasOwn(official.theme, 'brand'), false);
});

test('accepts a bounded static brand icon without requiring a short mark', () => {
  const profile = normalizeProfile({
    id: 'icon-brand',
    advanced: {brand: {enabled: true, displayName: null, iconImage: onePixelPng}},
  });
  assert.deepEqual(profile.advanced.brand, {
    enabled: true,
    displayName: null,
    shortMark: null,
    logoStyle: 'original',
    iconImage: onePixelPng,
  });
  const oversized = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`;
  assert.throws(
    () => normalizeProfile({advanced: {brand: {enabled: true, iconImage: oversized}}}),
    /2 MB/u,
  );
  const overDimension = Buffer.from(onePixelPng.slice('data:image/png;base64,'.length), 'base64');
  overDimension.writeUInt32BE(2049, 16);
  assert.throws(
    () => normalizeProfile({advanced: {brand: {
      enabled: true,
      iconImage: `data:image/png;base64,${overDimension.toString('base64')}`,
    }}}),
    /2048 px/u,
  );
});

test('rejects unsafe visual brand text, marks, shapes, and object fields', () => {
  const brand = (overrides) => ({
    schemaVersion: 1,
    advanced: {
      brand: {
        enabled: true,
        displayName: 'Dream Portal',
        shortMark: 'DP',
        logoStyle: 'diamond',
        ...overrides,
      },
    },
  });
  for (const displayName of [
    'Dream\nPortal',
    'Dream\u202EPortal',
    'https://evil.example',
    'Dream"Portal',
    "Dream'Portal",
    'Dream\\Portal',
  ]) {
    assert.throws(() => normalizeProfile(brand({displayName})), /brand\.displayName/u);
  }
  assert.throws(() => normalizeProfile(brand({shortMark: 'DP!'})), /brand\.shortMark/u);
  assert.throws(() => normalizeProfile(brand({shortMark: 'ABCD'})), /brand\.shortMark/u);
  assert.throws(() => normalizeProfile(brand({logoStyle: 'url-logo'})), /brand\.logoStyle/u);
  assert.throws(() => normalizeProfile(brand({shortMark: null})), /必须提供/u);
  assert.throws(() => normalizeProfile({advanced: {brand: {enabled: false, rawCss: 'body{}'}}}), /未允许字段/u);
  assert.throws(() => normalizeProfile({advanced: {brand: 'Dream'}}), /普通对象/u);
});

test('accepts static local PNG, JPEG, and WebP while rejecting unsafe image payloads', () => {
  assert.equal(validateImageDataUrl(onePixelWebp), onePixelWebp);
  assert.equal(validateImageDataUrl(onePixelPng), onePixelPng);
  assert.equal(validateImageDataUrl(onePixelJpeg), onePixelJpeg);
  assert.throws(() => validateImageDataUrl('https://example.com/a.png'));
  assert.throws(() => validateImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='));
  assert.throws(() => validateImageDataUrl('data:image/png;base64,SGVsbG8='));
  const oversized = `data:image/webp;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')}`;
  assert.throws(() => validateImageDataUrl(oversized));
});

test('normalizes a WorkBuddy project Hero with only declarative fit and position values', () => {
  const profile = normalizeProfile({
    id: 'project-hero',
    advanced: {
      workbuddy: {
        projectHero: {image: onePixelPng, fit: 'contain', position: 'top right'},
      },
    },
  });
  assert.deepEqual(profile.advanced.workbuddy.projectHero, {
    image: onePixelPng,
    fit: 'contain',
    position: 'top right',
  });

  const unsafeValues = normalizeProfile({
    advanced: {
      workbuddy: {
        projectHero: {image: null, fit: 'url(https://evil.example)', position: 'center;display:none'},
      },
    },
  });
  assert.equal(unsafeValues.advanced.workbuddy.projectHero.fit, 'cover');
  assert.equal(unsafeValues.advanced.workbuddy.projectHero.position, 'center');
  assert.throws(() => normalizeProfile({advanced: {workbuddy: {rawScript: 'alert(1)'}}}), /未允许字段/u);
  assert.throws(
    () => normalizeProfile({advanced: {workbuddy: {projectHero: {image: null, onload: 'alert(1)'}}}}),
    /未允许字段/u,
  );
  assert.throws(
    () => normalizeProfile({advanced: {workbuddy: {projectHero: {image: 'https://evil.example/hero.png'}}}}),
    /本地嵌入/u,
  );
});

test('rejects unknown schemas and string booleans', () => {
  assert.throws(() => normalizeProfile({schemaVersion: 99}));
  assert.throws(() => normalizeProfile({schemaVersion: 1, advanced: {enabled: 'false'}}));
  assert.throws(() => normalizeProfile({schemaVersion: 1, official: {opaqueWindows: 'false'}}));
});

test('profile writes are atomic and remain inside the data directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-profile-'));
  const saved = saveProfile({
    id: 'safe-profile',
    name: 'Safe',
    advanced: {workbuddy: {projectHero: {image: onePixelJpeg, fit: 'cover', position: 'right'}}},
  }, directory);
  assert.equal(getProfile('safe-profile', directory).name, 'Safe');
  assert.equal(getProfile('safe-profile', directory).advanced.brand.enabled, false);
  assert.deepEqual(getProfile('safe-profile', directory).advanced.workbuddy.projectHero, {
    image: onePixelJpeg,
    fit: 'cover',
    position: 'right',
  });
  fs.writeFileSync(path.join(directory, 'profiles', 'legacy-profile.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'legacy-profile',
    name: 'Legacy',
    advanced: {enabled: true},
  }), {mode: 0o600});
  assert.deepEqual(getProfile('legacy-profile', directory).advanced.workbuddy.projectHero, {
    image: null,
    fit: 'cover',
    position: 'center',
  });
  assert.ok(fs.existsSync(path.join(directory, 'profiles', `${saved.id}.json`)));
  assert.equal(getProfile('../escape', directory), null);
  const outside = path.join(directory, 'outside.json');
  fs.writeFileSync(outside, '{}');
  fs.symlinkSync(outside, path.join(directory, 'profiles', 'linked.json'));
  assert.equal(getProfile('linked', directory), null);
});

test('free WorkBuddy brand override is private, persistent, merge-only, and clearable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-free-brand-'));
  assert.deepEqual(loadFreeBrand(directory), {
    schemaVersion: 1,
    displayName: null,
    tagline: null,
    iconImage: null,
    composerAvatarImage: null,
    composerAvatarMotion: null,
    codexHomeTitle: null,
    doubaoHomeTitle: null,
    workbuddyHomeTitle: null,
    updatedAt: null,
  });
  const saved = saveFreeBrand({
    displayName: '我的 WorkBuddy',
    tagline: '我的职场搭档',
    iconImage: onePixelPng,
    composerAvatarImage: goodComposerWebp,
    composerAvatarMotion: 'hop',
  }, directory);
  assert.equal(saved.displayName, '我的 WorkBuddy');
  assert.equal(saved.tagline, '我的职场搭档');
  assert.equal(saved.iconImage, onePixelPng);
  assert.equal(saved.composerAvatarImage, goodComposerWebp);
  assert.equal(saved.composerAvatarMotion, 'hop');
  assert.equal(typeof saved.updatedAt, 'string');
  const filePath = path.join(directory, 'free-brand.json');
  assert.equal(fs.statSync(filePath).mode & 0o077, 0);
  assert.deepEqual(loadFreeBrand(directory), saved);

  const merged = mergeFreeBrandOverride(normalizeProfile({
    id: 'base-brand',
    advanced: {brand: {
      enabled: true,
      displayName: 'Dream Portal',
      shortMark: 'DP',
      logoStyle: 'diamond',
    }},
  }), saved);
  assert.deepEqual(merged.advanced.brand, {
    enabled: true,
    displayName: '我的 WorkBuddy',
    shortMark: 'DP',
    logoStyle: 'diamond',
    iconImage: onePixelPng,
  });
  assert.deepEqual(merged.advanced.workbuddy.homeCopy, {title: '我的 WorkBuddy', subtitle: '我的职场搭档'});
  assert.equal(merged.advanced.workbuddy.composerAvatar.image, goodComposerWebp);
  assert.equal(merged.advanced.workbuddy.composerAvatar.fit, 'contain');
  assert.equal(merged.advanced.workbuddy.composerAvatar.shape, 'square');
  assert.equal(merged.advanced.workbuddy.composerAvatar.activityMotion, 'float');
  const officialMotionOnly = mergeFreeBrandOverride(normalizeProfile({
    id: 'official-motion-only',
    advanced: {workbuddy: {composerAvatar: {
      image: goodComposerWebp,
      activityMotion: 'float',
    }}},
  }), {composerAvatarMotion: 'roll'});
  assert.equal(officialMotionOnly.advanced.workbuddy.composerAvatar.image, goodComposerWebp);
  assert.equal(officialMotionOnly.advanced.workbuddy.composerAvatar.activityMotion, 'float');
  assert.throws(
    () => saveFreeBrand({composerAvatarImage: circularCropWebp}, directory),
    /完整独立主体/u,
  );

  assert.throws(() => normalizeFreeBrand({iconImage: 'https://evil.example/logo.png'}), /本地嵌入/u);
  assert.throws(() => normalizeFreeBrand({rawCss: 'body{}'}), /未允许字段/u);
  assert.deepEqual(saveFreeBrand({displayName: null, tagline: null, iconImage: null, composerAvatarImage: null}, directory), {
    schemaVersion: 1,
    displayName: null,
    tagline: null,
    iconImage: null,
    composerAvatarImage: null,
    composerAvatarMotion: null,
    codexHomeTitle: null,
    doubaoHomeTitle: null,
    workbuddyHomeTitle: null,
    updatedAt: null,
  });
  assert.equal(fs.existsSync(filePath), false);
});

test('free brand storage rejects symlinks', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-free-brand-link-'));
  const outside = path.join(directory, 'outside.json');
  fs.writeFileSync(outside, '{}', {mode: 0o600});
  fs.symlinkSync(outside, path.join(directory, 'free-brand.json'));
  assert.throws(() => loadFreeBrand(directory), /不安全/u);
  assert.throws(() => saveFreeBrand({displayName: 'Safe'}, directory), /不安全|拒绝覆盖/u);
});

test('contrast ratio follows WCAG endpoints', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
});
