/**
 * Keeps the app's version numbers out of the runtime fingerprint.
 *
 * Under the `fingerprint` runtime version policy, `version` and
 * `android.versionCode` would otherwise take part in the hash, so every
 * version bump would move the runtime and strand the updates published for
 * it. A build made outside EAS Build also sets its versionCode from the
 * environment while its update is published without it, and the two would
 * never share a runtime. Neither number changes what native code can run.
 *
 * `sourceSkips` replaces the library default rather than adding to it, so the
 * default skip is listed again. It keeps the `android` and `ios` scripts in
 * `package.json` out of the hash; `expo prebuild` rewrites them to
 * `expo run:*`, and without the skip a runtime resolved after prebuild, as
 * EAS Build does, would differ from the one `eas update` publishes to.
 *
 * @type {import('expo/fingerprint').Config}
 */
const config = {
  sourceSkips: ['ExpoConfigVersions', 'PackageJsonAndroidAndIosScriptsIfNotContainRun'],
};

module.exports = config;
