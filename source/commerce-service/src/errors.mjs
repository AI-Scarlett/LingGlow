export class CommerceError extends Error {
  constructor(code, httpStatus, message, {cause} = {}) {
    super(message, cause === undefined ? undefined : {cause});
    this.name = 'CommerceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function commerceError(code, httpStatus, message, options) {
  return new CommerceError(code, httpStatus, message, options);
}

export function asCommerceError(error) {
  if (error instanceof CommerceError) return error;
  if (error && typeof error === 'object' &&
      typeof error.code === 'string' && Number.isInteger(error.httpStatus)) {
    return new CommerceError(error.code, error.httpStatus, error.message || error.code, {cause: error});
  }
  return new CommerceError('INTERNAL_ERROR', 500, '可信授权服务内部错误', {cause: error});
}

export function publicErrorBody(error, requestId) {
  const normalized = asCommerceError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.httpStatus >= 500 ? '可信授权服务暂不可用' : normalized.message,
      requestId,
    },
  };
}
