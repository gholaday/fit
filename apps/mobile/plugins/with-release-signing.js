const { withAppBuildGradle } = require("expo/config-plugins");

// Signs release builds with Fit's own key when FIT_KEYSTORE points at it, as the
// release workflow does from its secrets. Every update has to be signed with that same key,
// or Android refuses to install it over the app. Without the variable, release builds keep
// the debug key, so local builds work with no setup.
//   FIT_KEYSTORE           path to the .jks file
//   FIT_KEYSTORE_PASSWORD  its password
//   FIT_KEY_ALIAS          the key's alias
//   FIT_KEY_PASSWORD       the key's password

const MARKER = "// fit: release signing";

const SIGNING = `        ${MARKER}
        release {
            if (System.getenv("FIT_KEYSTORE")) {
                storeFile file(System.getenv("FIT_KEYSTORE"))
                storePassword System.getenv("FIT_KEYSTORE_PASSWORD")
                keyAlias System.getenv("FIT_KEY_ALIAS")
                keyPassword System.getenv("FIT_KEY_PASSWORD")
            }
        }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    const configs = "signingConfigs {\n";
    const release = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!gradle.includes(configs) || !release.test(gradle)) {
      throw new Error("with-release-signing: app/build.gradle no longer has the expected signing setup");
    }
    gradle = gradle.replace(configs, `${configs}${SIGNING}`);
    gradle = gradle.replace(
      release,
      '$1signingConfig System.getenv("FIT_KEYSTORE") ? signingConfigs.release : signingConfigs.debug',
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
