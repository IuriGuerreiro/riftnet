const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');

/**
 * pnpm workspace setup:
 * - watch client/src so shared code (proto types, schemas) bundles.
 * - resolve packages from mobile/node_modules first, so shared files use our copies.
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [path.join(root, 'client/src'), path.join(root, 'node_modules')],
  resolver: {
    nodeModulesPaths: [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')],
    unstable_enableSymlinks: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
