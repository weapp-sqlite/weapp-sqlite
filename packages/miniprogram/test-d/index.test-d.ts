import type { MiniProgramPlatform, MiniProgramSqliteCapabilityReport, MiniProgramSqliteWasmStorage } from '..'
import { expectType } from 'tsd'
import { createMiniProgramSqliteWasmStorage, probeMiniProgramSqliteCapabilities } from '..'

const platform: MiniProgramPlatform = 'weapp'
expectType<MiniProgramSqliteWasmStorage>(createMiniProgramSqliteWasmStorage({ platform, runtime: {} }))
expectType<Promise<MiniProgramSqliteCapabilityReport>>(probeMiniProgramSqliteCapabilities({ platform, runtime: {} }))
