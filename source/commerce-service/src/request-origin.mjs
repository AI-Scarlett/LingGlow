import {commerceError} from './errors.mjs';

function singleHeader(value, label) {
  if (Array.isArray(value) || typeof value !== 'string' || !value || value.includes(',')) {
    throw commerceError('PROXY_HEADERS_INVALID', 400, `${label} 头不合法`);
  }
  return value.trim().toLowerCase();
}

// A dual-stack listener reports an IPv4 peer as '::ffff:10.0.0.5'; both sides
// of the comparison are reduced to the same textual form.
function normalizedAddress(value) {
  const address = String(value ?? '').toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(address);
  return mapped === null ? address : mapped[1];
}

function normalizedAuthority(value) {
  try {
    const parsed = new URL(`https://${value}`);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error('not an authority');
    }
    return parsed.host.toLowerCase();
  } catch {
    throw commerceError('PUBLIC_ORIGIN_MISMATCH', 400, '请求 Host 不合法');
  }
}

export function createRequestOriginPolicy({publicBaseUrl, trustedProxyAddresses = []} = {}) {
  const expected = new URL(publicBaseUrl);
  if (expected.protocol !== 'https:' || expected.pathname !== '/' || expected.search || expected.hash ||
      expected.username || expected.password) {
    throw new Error('publicBaseUrl 必须是不带路径、查询或凭据的 HTTPS origin');
  }
  const trusted = new Set(trustedProxyAddresses.map(normalizedAddress));
  return Object.freeze({
    assertPublicHttps(request) {
      const remote = normalizedAddress(request.socket?.remoteAddress ?? '');
      const hasForwarded = request.headers.forwarded !== undefined ||
        request.headers['x-forwarded-proto'] !== undefined || request.headers['x-forwarded-host'] !== undefined;
      if (request.socket?.encrypted === true) {
        if (hasForwarded) throw commerceError('PROXY_HEADERS_NOT_TRUSTED', 400, '直连 TLS 请求不接受代理头');
        const host = normalizedAuthority(singleHeader(request.headers.host, 'Host'));
        if (host !== expected.host.toLowerCase()) {
          throw commerceError('PUBLIC_ORIGIN_MISMATCH', 400, '请求 Host 与公开服务地址不一致');
        }
        return true;
      }
      if (!trusted.has(remote)) {
        if (hasForwarded) throw commerceError('PROXY_HEADERS_NOT_TRUSTED', 400, '不信任该来源的代理头');
        throw commerceError('HTTPS_REQUIRED', 400, '商业化接口只允许 HTTPS');
      }
      if (request.headers.forwarded !== undefined) {
        throw commerceError('PROXY_HEADERS_INVALID', 400, '不允许模棱两可的 Forwarded 头');
      }
      const proto = singleHeader(request.headers['x-forwarded-proto'], 'X-Forwarded-Proto');
      const host = normalizedAuthority(singleHeader(request.headers['x-forwarded-host'], 'X-Forwarded-Host'));
      if (proto !== 'https') throw commerceError('HTTPS_REQUIRED', 400, '公开请求必须经 HTTPS 入口');
      if (host !== expected.host.toLowerCase()) {
        throw commerceError('PUBLIC_ORIGIN_MISMATCH', 400, '代理 Host 与公开服务地址不一致');
      }
      return true;
    },
  });
}
