// Both package formats use this declaration bridge. Preserve the type-only
// imports verbatim: declaration bundling currently drops resolution-mode.
import type {} from './devframe-rpc.mjs' with { 'resolution-mode': 'import' }

export type { DevframeDefinition } from 'devframe' with { 'resolution-mode': 'import' }
