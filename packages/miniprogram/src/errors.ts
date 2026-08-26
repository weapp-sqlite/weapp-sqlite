import type { MiniProgramPlatform, MiniProgramSqliteCapability, MiniProgramSqliteErrorCode } from './types'

export class MiniProgramSqliteUnsupportedError extends Error {
  constructor(
    readonly platform: MiniProgramPlatform,
    readonly capability: MiniProgramSqliteCapability,
    readonly code: MiniProgramSqliteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MiniProgramSqliteUnsupportedError'
  }
}
