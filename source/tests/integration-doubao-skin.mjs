#!/usr/bin/env node
// Real-client visual regression for the applied Doubao skin. The probe reads
// only structural attributes, geometry and computed styles; it never reads
// conversation text or editor content.
import assert from 'node:assert/strict';
import {compatibilityFor} from '../src/adapter.mjs';
import {listRegisteredThemePacks, materializeThemePack} from '../src/catalog/theme-pack.mjs';
import {SkinSessionManager} from '../src/cdp.mjs';
import {findClientApp, launchStock, runningMainProcesses} from '../src/client-app.mjs';
import {refuseManagedLiveSession} from './helpers/live-session-guard.mjs';

await refuseManagedLiveSession('doubao');

const app = findClientApp('doubao', {fresh: true});
const compatibility = compatibilityFor(app);
const profile = materializeThemePack(
  listRegisteredThemePacks({clientId: 'doubao'})
    .find((entry) => entry.id === 'baxian-ensemble' && entry.clientIds.includes('doubao')),
  'doubao',
);
assert.equal(profile.advanced.workbuddy.composerAvatar.activityMotion, 'float');
const manager = new SkinSessionManager({log: () => {}});
let restored = false;

try {
  await manager.launch({app, profile, compatibility, confirmRestart: true});
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const tracked = manager.targets.values().next().value;
  const result = await manager.evaluateValue(`(() => {
    const input = document.querySelector('[data-testid="chat_input"]');
    const mascotAnchor = document.querySelector('[data-lingglow-doubao-composer="true"]');
    const chain = [];
    for (let node = input; node && chain.length < 10; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      chain.push({
        tag: node.tagName.toLowerCase(),
        classes: typeof node.className === 'string'
          ? node.className.split(/\\s+/u).filter(Boolean).slice(0, 12)
          : [],
        id: node.id || '',
        dataKeys: Object.keys(node.dataset).sort(),
        role: node.getAttribute('role'),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        overflow: style.overflow,
        position: style.position,
      });
    }
    const style = mascotAnchor ? getComputedStyle(mascotAnchor, '::after') : null;
    const nativeInputAfter = input ? getComputedStyle(input, '::after') : null;
    const animation = mascotAnchor?.getAnimations({subtree: true})
      .find((candidate) => candidate.animationName?.startsWith('lingglow-composer-'));
    const idlePlayState = animation?.playState || null;
    const rootAgentActive = document.documentElement.getAttribute('data-lingglow-agent-active');
    let samples = null;
    if (animation) {
      animation.pause();
      const duration = Number(animation.effect?.getComputedTiming?.().duration);
      const sample = (progress) => {
        animation.currentTime = duration * progress;
        void mascotAnchor.offsetWidth;
        const current = getComputedStyle(mascotAnchor, '::after');
        const matrix = current.transform === 'none' ? null : new DOMMatrixReadOnly(current.transform);
        return {
          right: Number.parseFloat(current.right),
          transform: current.transform,
          x: matrix?.e ?? 0,
          angle: matrix ? Math.atan2(matrix.b, matrix.a) * 180 / Math.PI : 0,
          determinant: matrix ? (matrix.a * matrix.d) - (matrix.b * matrix.c) : 1,
        };
      };
      samples = {
        duration,
        start: sample(0),
        outboundBefore: sample(.10),
        outboundAfter: sample(.11),
        outbound: sample(.25),
        farOutbound: sample(.499),
        farReturn: sample(.501),
        returning: sample(.75),
        returnBefore: sample(.90),
        returnAfter: sample(.91),
        end: sample(1),
      };
    }
    return {
      chain,
      rootProfileId: document.documentElement.getAttribute('data-codex-skin-studio'),
      bodyBackgroundUsesLocalWebP: getComputedStyle(document.body, '::before')
        .backgroundImage.includes('data:image/webp;base64,'),
      chatStageBackgroundUsesLocalWebP: (() => {
        const stage = document.querySelector('#chat-route-main');
        return stage ? getComputedStyle(stage).backgroundImage.includes('data:image/webp;base64,') : false;
      })(),
      inputCount: document.querySelectorAll('[data-testid="chat_input"]').length,
      mascotAnchorCount: document.querySelectorAll('[data-lingglow-doubao-composer="true"]').length,
      mascotAnchorIsInput: mascotAnchor === input,
      mascotAnchorWidth: mascotAnchor?.getBoundingClientRect().width ?? 0,
      mascotTravel: mascotAnchor ? getComputedStyle(mascotAnchor)
        .getPropertyValue('--lingglow-mascot-travel-x').trim() : '',
      idlePlayState,
      rootAgentActive,
      nativeInputAfter: nativeInputAfter ? {
        content: nativeInputAfter.content,
        borderTopWidth: nativeInputAfter.borderTopWidth,
        animationName: nativeInputAfter.animationName,
      } : null,
      pseudo: style ? {
        content: style.content,
        right: style.right,
        animationName: style.animationName,
        backgroundImage: style.backgroundImage === 'none' ? 'none' : 'present',
      } : null,
      samples,
    };
  })()`, tracked.sessionId);
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.rootProfileId, profile.id);
  assert.equal(result.bodyBackgroundUsesLocalWebP, true,
    '豆包全局背景没有加载当前皮肤的本地图片');
  assert.equal(result.chatStageBackgroundUsesLocalWebP, true,
    '豆包主对话区没有加载当前皮肤的本地背景图片');
  assert.equal(result.inputCount, 1);
  assert.equal(result.mascotAnchorCount, 1);
  assert.equal(result.mascotAnchorIsInput, false,
    '豆包挂件不能再占用输入框自己的 ::after');
  assert.ok(result.mascotAnchorWidth > 700, '豆包挂件容器没有覆盖完整输入框宽度');
  assert.equal(result.nativeInputAfter?.borderTopWidth, '1px');
  assert.equal(result.nativeInputAfter?.animationName, 'none');
  assert.match(result.pseudo?.animationName ?? '', /^lingglow-composer-float$/u);
  assert.equal(result.idlePlayState, 'paused', '豆包空闲时挂件必须暂停');
  assert.equal(result.rootAgentActive, null, '豆包空闲时不能伪造生成中状态');
  assert.match(result.mascotTravel, /^-\d+px$/u, '豆包挂件没有按实际输入框宽度计算路程');
  assert.ok(result.samples.start.x - result.samples.farOutbound.x > 700,
    '豆包滚动挂件没有用 transform 横穿输入框');
  assert.ok(Math.abs(result.samples.farOutbound.x - result.samples.farReturn.x) < 3,
    '豆包挂件掉头前后没有停在同一端');
  assert.ok(Math.abs(result.samples.end.x - result.samples.start.x) < 3,
    '豆包挂件没有返回起点');
  assert.ok(result.samples.outbound.determinant < 0,
    '八仙船去程没有朝向行进方向');
  assert.ok(result.samples.returning.determinant > 0,
    '八仙船返程没有掉头');
  await manager.restoreStock(app, {confirmRestart: true});
  restored = true;
} finally {
  if (!restored) {
    try {
      const current = findClientApp('doubao', {fresh: true});
      if (manager.status().mode && current?.safeToLaunch) {
        await manager.restoreStock(current, {confirmRestart: true});
      } else {
        await manager.stop({terminateApp: Boolean(manager.status().mode)});
        if (current?.safeToLaunch && !runningMainProcesses(current).length) await launchStock(current);
      }
    } catch {}
  }
}
