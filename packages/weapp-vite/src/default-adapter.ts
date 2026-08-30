/// <reference path="./virtual.d.ts" />

import type { SqliteRuntimeAdapter } from './types'
import adapter from 'virtual:weapp-sqlite-runtime'

export const defaultSqliteRuntimeAdapter: SqliteRuntimeAdapter = adapter
