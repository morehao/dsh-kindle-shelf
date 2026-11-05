/** 业务错误：路由层按 code 映射 HTTP 状态。 */
export class KindlError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'KindlError';
    this.code = code;
  }
}

export const err = (code: string, message: string): KindlError => new KindlError(code, message);
