// This protocol is intentionally tiny and data-only so both the isolated QA
// harness and the ordinary transport gate agree on what a *candidate* runtime
// observation means.  A candidate is never an authorization to enable a
// Doubao adapter or to inject a skin.
export const DOUBAO_QA_EVIDENCE_SCHEMA_VERSION = 1;
export const DOUBAO_QA_EVIDENCE_KIND = 'lingglow.doubao-isolated-qa-evidence';
export const DOUBAO_QA_CANDIDATE_STATUS = 'candidate-runtime-probe';
export const DOUBAO_QA_ISOLATION_SCOPE = 'temporary-user-data-dir-only';
export const DOUBAO_QA_DOM_PROBE_SCOPE = 'fixed-dom-counts-no-content';

// Keep this copy close to the actual protocol, rather than presenting a
// temporary Chromium profile as stronger isolation than it is.  In
// particular, this harness deliberately does not create a separate macOS
// account or VM.
export const DOUBAO_QA_AUTHORIZATION_COPY =
  '本操作会正常退出并重新启动当前 macOS 用户下的豆包，只创建临时 Chromium user-data-dir，' +
  '不等同于独立 macOS 用户或虚拟机；它不会注入皮肤、读取页面文字/输入值/Cookie/Storage，' +
  '只读取固定 DOM 节点数量，并在清理和原版恢复均获确认后才输出候选证据。';
