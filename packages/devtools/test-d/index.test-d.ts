/* eslint-disable antfu/no-import-dist */
import type {
  CreateSqliteDevtoolsDevframeOptions,
  SqliteDevtoolsClient,
  SqliteDevtoolsMethod,
  SqliteDevtoolsPlugin,
  SqliteDevtoolsReleaseSession,
  SqliteDevtoolsServer,
} from '../dist/index.mjs'
import type {
  ConnectSqliteDevtoolsRuntimeOptions,
  SqliteDevtoolsRuntimeConnection,
} from '../dist/runtime.mjs'
import { expectAssignable, expectType } from 'tsd'
import {
  connectDevtoolsClient,
  createSqliteDevtoolsDevframe,
  createSqliteDevtoolsPlugin,
  startSqliteDevtoolsServer,
} from '../dist/index.mjs'
import { connectSqliteDevtoolsRuntime } from '../dist/runtime.mjs'

const options: CreateSqliteDevtoolsDevframeOptions = { allowWrite: true, requestTimeoutMs: 5000 }
const controller = createSqliteDevtoolsDevframe(options)
expectType<Promise<void>>(controller.dispose())
expectType<SqliteDevtoolsPlugin>(createSqliteDevtoolsPlugin(controller))

expectType<Promise<SqliteDevtoolsServer>>(startSqliteDevtoolsServer({ port: 0 }))
expectType<Promise<SqliteDevtoolsClient>>(connectDevtoolsClient())
declare const devtoolsClient: SqliteDevtoolsClient
expectType<Promise<void>>(devtoolsClient.dispose())
expectAssignable<SqliteDevtoolsMethod>('analyzeQuery')
expectAssignable<SqliteDevtoolsMethod>('getMigrationDiagnostics')
expectAssignable<SqliteDevtoolsMethod>('getForeignKeyDiagnostics')

declare const releaseSession: SqliteDevtoolsReleaseSession
expectType<string>(releaseSession.runtimeId)
expectType<string>(releaseSession.sessionId)
expectType<string | undefined>(releaseSession.ownerId)

declare const runtimeOptions: ConnectSqliteDevtoolsRuntimeOptions
expectType<SqliteDevtoolsRuntimeConnection>(connectSqliteDevtoolsRuntime(runtimeOptions))
