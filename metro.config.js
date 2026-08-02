// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** The Metro configuration this project bundles with. */
const config = getDefaultConfig(__dirname);

/**
 * Resolves @sinclair/typebox to its CommonJS build.
 *
 * TypeBox exports a member named `Object`. Its ESM build aliases the global to
 * keep using it (`const Object = _Object_`), which becomes a hoisted `var` when
 * Metro rewrites the module to CommonJS - and a hoisted `var Object` shadows
 * the global for the whole module, including the `Object.defineProperty(exports,
 * '__esModule', ...)` line the rewrite puts at the top. That line then runs
 * against `undefined` and the bundle dies before the app registers, which only
 * shows up in a release build:
 *
 *   TypeError: Cannot read property 'defineProperty' of undefined
 *   Invariant Violation: "main" has not been registered
 *
 * The CommonJS build assigns to `exports.Object` instead of declaring a local
 * one, so the global survives. Scoped to this package: every other dependency
 * keeps resolving through its exports map as before.
 * @param {import('metro-resolver').ResolutionContext} context - Resolution context.
 * @param {string} moduleName - The specifier being resolved.
 * @param {string | null} platform - The platform being bundled for.
 * @returns {import('metro-resolver').Resolution} Where the specifier resolves to.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isTypeBox =
    moduleName === '@sinclair/typebox' || moduleName.startsWith('@sinclair/typebox/');
  return context.resolveRequest(
    isTypeBox ? { ...context, unstable_enablePackageExports: false } : context,
    moduleName,
    platform,
  );
};

module.exports = config;
