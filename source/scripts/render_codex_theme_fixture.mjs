import {writeFileSync} from 'node:fs';
import {codexDreamSkinCssForTesting} from '../src/codex-dream-skin-adapter.mjs';

const shell = process.argv[2] === 'dark' ? 'dark' : 'light';
const output = process.argv[3];
if (!output) throw new Error('output path is required');

const nativeDarkLeak = [
  '.text-token-conversation-header{color:rgba(255,255,255,.92)}',
  '.text-token-conversation-body{color:rgba(255,255,255,.78)}',
  '.text-token-description-foreground{color:rgba(255,255,255,.56)}',
  '.bg-token-bg-secondary{background:rgba(20,24,30,.82)}',
].join('');
const fixtureCss = [
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100vh;font:16px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}',
  'body::before{content:"";position:fixed;inset:0;background:radial-gradient(circle at 73% 38%,rgba(229,111,138,.48),transparent 24%),linear-gradient(135deg,#bfe6ee 0%,#f7e7e8 48%,#87afb8 100%);z-index:-1}',
  '.shell{display:grid;grid-template-columns:300px 1fr 300px;min-height:100vh}',
  'aside{padding:34px 22px}aside h1{margin:0 0 24px}aside button{display:block;width:100%;margin:8px 0;padding:11px 14px;border:0;text-align:left;color:inherit;background:transparent}',
  'main{padding:42px}.dream-skin-home{min-height:calc(100vh - 84px)}',
  '.title{text-align:center;margin-top:56px;font-size:32px}',
  '.group\\/home-suggestions{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:34px auto;max-width:920px}',
  '.group\\/home-suggestions button{min-height:120px;padding:18px;text-align:left}',
  '.conversation{max-width:940px;margin:28px auto}.conversation h2{margin-bottom:6px}.artifact{margin:20px 0;padding:22px;border-radius:18px}',
  '[data-app-shell-focus-area="right-panel"]{margin:20px 18px 20px 0;padding:22px;border-radius:20px}',
  '.composer-surface-chrome{position:fixed;left:350px;right:330px;bottom:28px;padding:24px;min-height:150px}',
  '.composer-row{position:absolute;left:20px;right:20px;bottom:18px;display:flex;gap:12px;align-items:center}.composer-row button{padding:10px 14px}.composer-row .model{margin-left:auto}.composer-row .send,.composer-row .stop{width:46px;height:46px;padding:0}',
  '[role="menu"]{position:fixed;right:355px;bottom:195px;width:260px;padding:12px}[role="menuitem"]{display:block;width:100%;padding:10px 12px;border:0;text-align:left;background:transparent;color:inherit}',
].join('');
const html = [
  '<!doctype html>',
  '<html class="electron-dark codex-dream-skin" data-dream-shell="' + shell + '" data-lingglow-appearance="' + shell + '" data-dream-route-home="true">',
  '<head><meta charset="utf-8"><style>' + nativeDarkLeak + fixtureCss + codexDreamSkinCssForTesting() + '</style></head>',
  '<body><div class="shell">',
  '<aside class="app-shell-left-panel"><h1>Codex</h1><button>新建任务</button><button aria-current="page">已安排</button><button>插件</button><p class="text-token-description-foreground">置顶</p><button>电脑磁盘管理</button><button>官网维护更新</button><button>图书视频项目</button></aside>',
  '<main class="main-surface dream-skin-home" role="main"><div class="title text-token-conversation-header" data-feature="game-source">我们应该在灵妆中做些什么？</div>',
  '<div class="group/home-suggestions"><button><span class="text-token-conversation-body">探索并理解代码</span></button><button><span class="text-token-conversation-body">构建新功能、应用或工具</span></button><button><span class="text-token-conversation-body">审查代码并提出修改建议</span></button><button><span class="text-token-conversation-body">修复问题和失败</span></button></div>',
  '<section class="conversation"><h2 class="text-token-conversation-header">灵妆 · Codex 主题适配</h2><p class="text-token-conversation-body">对话正文、过程信息、文件卡片和操作图标必须与皮肤明暗保持一致。</p><div class="artifact bg-token-bg-secondary"><strong class="text-token-conversation-header">已编辑 6 个文件</strong><p class="text-token-description-foreground">README.md · v2.3.6-notes.md · latest.json</p></div></section></main>',
  '<section data-app-shell-focus-area="right-panel"><h2 class="text-token-conversation-header">输出</h2><p class="text-token-conversation-body">README.md</p><p class="text-token-description-foreground">来源与浏览器</p></section>',
  '</div><section class="composer-surface-chrome" data-codex-composer-root><div contenteditable="true">今天帮你做些什么？</div><div class="composer-row"><button data-lingglow-codex-control="permission"><span>完全访问</span></button><button class="model" data-lingglow-codex-control="model"><span>5.6 Sol 极高</span></button><button class="stop" data-lingglow-codex-control="stop"><span>■</span></button><button class="send" data-lingglow-codex-control="send"><span>↑</span></button></div></section>',
  '<div role="menu"><div role="menuitem" data-state="active"><span>模型</span><span>5.6 Sol ›</span></div><div role="menuitem"><span>推理强度</span><span>极高 ›</span></div><div role="menuitem"><span>速度</span><span>标准 ›</span></div><hr role="separator"><div role="menuitem"><span>个性化</span></div></div>',
  '<div role="menu" style="right:75px"><div role="menuitemradio" aria-checked="true"><span>5.6 Sol</span><span>✓</span></div><div role="menuitemradio"><span>5.6 Terra</span></div><div role="menuitemradio"><span>5.6 Luna</span></div><div role="menuitemradio"><span>5.5</span></div><div role="menuitemradio"><span>5.4 Mini</span></div></div>',
  '</body></html>',
].join('');

writeFileSync(output, html, {mode: 0o600});
