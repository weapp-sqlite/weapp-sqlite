import type { SqliteDevtoolsInvocation, SqliteDevtoolsReleaseSession, SqliteDevtoolsResult, SqliteDevtoolsRuntimeDescriptor } from '@weapp-sqlite/devtools/protocol'
import type { DevframeDefinition, DevframeRpcClientFunctions, DevframeRpcServerFunctions } from 'devframe' with { 'resolution-mode': 'import' }
import { createSqliteDevtoolsDevframe, createSqliteDevtoolsPlugin } from '@weapp-sqlite/devtools'

type Equal<Actual, Expected> = (<T>() => T extends Actual ? 1 : 2) extends (<T>() => T extends Expected ? 1 : 2) ? true : false
type Assert<Value extends true> = Value

const controller = createSqliteDevtoolsDevframe({ allowWrite: true })
export const plugin = createSqliteDevtoolsPlugin(controller)

export type DefinitionIsPreserved = Assert<Equal<typeof controller.definition, DevframeDefinition>>
export type PluginIsServeOnly = Assert<Equal<typeof plugin.apply, 'serve'>>
export type ListRuntimesRpc = Assert<Equal<DevframeRpcServerFunctions['weapp-sqlite:list-runtimes'], (ownerId?: string) => SqliteDevtoolsRuntimeDescriptor[]>>
export type InvokeRpc = Assert<Equal<DevframeRpcServerFunctions['weapp-sqlite:invoke'], (input: SqliteDevtoolsInvocation) => Promise<SqliteDevtoolsResult>>>
export type ReleaseSessionRpc = Assert<Equal<DevframeRpcServerFunctions['weapp-sqlite:release-session'], (input: SqliteDevtoolsReleaseSession) => Promise<SqliteDevtoolsResult>>>
export type StateUpdatedRpc = Assert<Equal<DevframeRpcClientFunctions['weapp-sqlite:state-updated'], (runtimes: SqliteDevtoolsRuntimeDescriptor[]) => void>>

declare const invoke: DevframeRpcServerFunctions['weapp-sqlite:invoke']
// @ts-expect-error The augmented RPC must retain the required invocation fields.
invoke({ runtimeId: 'runtime' })
