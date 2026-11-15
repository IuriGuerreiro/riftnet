module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    '@babel/plugin-transform-export-namespace-from', // zod v4 uses 'export * as'
    [
      'module-resolver',
      {
        // Code shared with the desktop client. Keep in sync with tsconfig "paths".
        alias: { '@shared': '../client/src' },
        extensions: ['.ts', '.tsx', '.js'],
      },
    ],
  ],
};
