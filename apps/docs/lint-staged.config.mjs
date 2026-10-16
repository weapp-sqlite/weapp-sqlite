import { defineLintStagedConfig } from 'repoctl/tooling';

// Run staged checks in this app so ESLint uses its local version and config.
export default await defineLintStagedConfig();
