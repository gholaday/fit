// Expo's defaults, watching less: the workspace has the API, a 1.5 GB android build and
// package tests that the app never imports, and without Watchman every watched file costs.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, '../..');
const escape = (p) => p.replace(/[\\/]/g, '[\\\\/]').replace(/\./g, '\\.');

config.watchFolders = config.watchFolders.filter((f) => f !== path.join(root, 'apps', 'api'));

const blocked = [
  new RegExp(`^${escape(path.join(root, 'apps', 'api'))}[\\\\/].*`),
  new RegExp(`^${escape(path.join(__dirname, 'android'))}[\\\\/].*`),
  new RegExp(`^${escape(path.join(__dirname, 'ios'))}[\\\\/].*`),
  /[\\/]\.expo[\\/].*/,
  new RegExp(`^${escape(path.join(root, 'packages'))}[\\\\/][^\\\\/]+[\\\\/](dist|drizzle|scripts)[\\\\/].*`),
  new RegExp(`^${escape(path.join(root, 'packages'))}[\\\\/].*\\.test\\.ts$`),
];
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...blocked];

module.exports = config;
