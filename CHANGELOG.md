# Changelog

## [0.4.0](https://github.com/MasRama/nokta/compare/v0.3.0...v0.4.0) (2026-10-27)


### Features

* **extension:** show privacy dots for the camera, microphone and screen sharing ([46e5875](https://github.com/MasRama/nokta/commit/46e5875310995c0f4fb4d7eb0316c56711ef4860))
* **lyrics:** read lyrics from your own .lrc files ([90a408c](https://github.com/MasRama/nokta/commit/90a408c24c7457af46dfabad317ef922863f7fc2))
* **media:** switch between players from the notch ([12c05e5](https://github.com/MasRama/nokta/commit/12c05e505c21403578a58958729c850eacd1f0eb))
* **notifications:** show notifications in the notch ([14a306a](https://github.com/MasRama/nokta/commit/14a306a8acc004bec9286e5040378d1066d83e91))
* **timer:** silence notification banners while focusing ([402db21](https://github.com/MasRama/nokta/commit/402db21c4f3e3d11d02cd89db1d42f39a6798a23))
* **timer:** start and stop focus with a shortcut ([fe4b6dc](https://github.com/MasRama/nokta/commit/fe4b6dcbca352718a57abbf9116482672c49d87b))
* **timer:** take a long break after four sessions ([fb84bee](https://github.com/MasRama/nokta/commit/fb84bee38f35ad8a1ce45c7383bf1ba90f6ff367))


### Bug Fixes

* **lyrics:** find lyrics for songs played on YouTube in a browser ([07e1a08](https://github.com/MasRama/nokta/commit/07e1a089d99245145eaf110de66c851c1d7eda7d))

## [0.3.0](https://github.com/MasRama/nokta/compare/v0.2.0...v0.3.0) (2026-10-27)


### Features

* **core:** use each system's folders for config and cache ([09dbda4](https://github.com/MasRama/nokta/commit/09dbda453bc6120e0ab26994ff21adbf2deb262b))
* **extension:** run on GNOME 46 to 51 ([872c7c2](https://github.com/MasRama/nokta/commit/872c7c2c2fc359873a52ae30a62965ee64587287))
* **osd:** take over the OSD on GNOME 49 and later ([eb25991](https://github.com/MasRama/nokta/commit/eb25991e13bc46508279a4ff4d8e8a7ce25fc092))
* **settings:** add focus timer lengths and sound to the config ([160f322](https://github.com/MasRama/nokta/commit/160f32216ace88a089c39f2369863a65f12d65de))
* **settings:** link to the install steps when Nokta's service is missing ([d9a9f3a](https://github.com/MasRama/nokta/commit/d9a9f3aed0412adb79663984e8f582faf1a2779a))
* **settings:** set the focus timer in the settings window ([cdff536](https://github.com/MasRama/nokta/commit/cdff53642ab572c95c39e6a4cd14d8b75b738081))
* **timer:** run a focus timer in noktad ([53f809d](https://github.com/MasRama/nokta/commit/53f809d4e26d971bcdcb1e878167bfab8640b357))
* **timer:** show the focus timer in the notch and Quick Settings ([7ca975e](https://github.com/MasRama/nokta/commit/7ca975ef23f9aa018407e9f3fcc32c2bc044f958))


### Bug Fixes

* **app:** start without CA certificates on the system ([a661626](https://github.com/MasRama/nokta/commit/a661626f90f7924248e2834f94d1dd6873ddcf73))
* **extension:** build vertical boxes and read Caps Lock on newer GNOME ([e14a0d0](https://github.com/MasRama/nokta/commit/e14a0d0b6180fb229e7a4953734c355da7f9bbfc))
* **extension:** connect to Nokta's service the way GNOME 51 expects ([d17ccd3](https://github.com/MasRama/nokta/commit/d17ccd3de49f96f83e35564744ee429b586e28dc))
* **extension:** leave the notch alone once GNOME Shell destroys it ([2779bdb](https://github.com/MasRama/nokta/commit/2779bdb001530152e48c49c8445464444701701c))

## [0.2.0](https://github.com/MasRama/nokta/compare/v0.1.0...v0.2.0) (2026-10-27)


### Features

* **contracts:** add io.nokta.Devices1 with the Alert signal ([9f17062](https://github.com/MasRama/nokta/commit/9f1706260a7df07c25a3fc4042646060a11fed79))
* **devices:** send Bluetooth, charger and battery alerts ([4eca95e](https://github.com/MasRama/nokta/commit/4eca95e05b26541e0fbe0dc6770011f3a2a46f63))
* **devices:** show device alerts in the notch ([ab06cbb](https://github.com/MasRama/nokta/commit/ab06cbb91d254c7cc13bf8680459b586b123663b))
* **extension:** see-through notch, accent color and 24-hour clock ([e614732](https://github.com/MasRama/nokta/commit/e61473238ef3cfb6f28a77236204db27ab46de14))
* **extension:** show a notch on every monitor ([8cb910b](https://github.com/MasRama/nokta/commit/8cb910b7a17e4da61dd116d981ed18388bc66661))
* **osd:** show volume, brightness and Caps Lock in the notch ([2774e0d](https://github.com/MasRama/nokta/commit/2774e0d630d57c982fb49d0ee64559905265b75b))
* **settings:** add a settings window ([2f5b05a](https://github.com/MasRama/nokta/commit/2f5b05a73eef6e7cf5c8ba332ef591c962f6f7fc))
* **settings:** add the all_monitors setting ([11383af](https://github.com/MasRama/nokta/commit/11383afd7503dca96f053238e55acc64daf75e0e))
* **settings:** add the device alert settings ([1f8e29b](https://github.com/MasRama/nokta/commit/1f8e29bde7ffa892e12b6d06f40aa12a9671e6f7))
* **settings:** add the OSD and Caps Lock settings ([a01dd11](https://github.com/MasRama/nokta/commit/a01dd11e533c2f792610501b4fce2741aef9d137))
* **settings:** add transparency, accent color and clock settings ([e770fa0](https://github.com/MasRama/nokta/commit/e770fa089c2afb4f4ebcf48d2ed40d91d339f19f))
* **settings:** change settings over D-Bus ([92ef1e8](https://github.com/MasRama/nokta/commit/92ef1e809d22f4b986647217533b1b2fa3a1810a))

## 0.1.0 (2026-10-27)


### Features

* **app:** serve the io.nokta interfaces on the session bus ([f6a2262](https://github.com/MasRama/nokta/commit/f6a226268fcada22e7218594bb54ddf3ac5fcc55))
* **contracts:** define the io.nokta v1 D-Bus interfaces ([2d02649](https://github.com/MasRama/nokta/commit/2d02649930f1942479d8525e7f901578ab707750))
* **extension:** add position, lyric line and time formatting logic ([565a596](https://github.com/MasRama/nokta/commit/565a59612d0ed82ecce51bdbe7779cb41594eb16))
* **extension:** draw the notch at the top edge with an idle clock ([c25a0c0](https://github.com/MasRama/nokta/commit/c25a0c009573fa85914cbd59a9c5291854d5830e))
* **extension:** move the GNOME clock to the right of the top bar ([bed940d](https://github.com/MasRama/nokta/commit/bed940d18cc7abe210417168ee607044c58737f5))
* **extension:** show the current synced lyric line ([a580fd5](https://github.com/MasRama/nokta/commit/a580fd58becae2773d622c9c97784a08c475cf7f))
* **extension:** show the playing track with controls in the notch ([bb573c4](https://github.com/MasRama/nokta/commit/bb573c4af28243f51bc142ae19f657aaaeb9d663))
* **lyrics:** fetch lyrics on track change and drop stale results ([d9d5fa5](https://github.com/MasRama/nokta/commit/d9d5fa5232319a8efb9eff8ddefc338b53a735fb))
* **lyrics:** look up synced lyrics on LRCLIB with search fallback ([001863e](https://github.com/MasRama/nokta/commit/001863e0ea855ae669f40b3ed061c23d1365fe1f))
* **lyrics:** parse LRC lyrics and cache lookups per track ([c7a7034](https://github.com/MasRama/nokta/commit/c7a7034da099f41cb39fa65a84fb5550303d5d28))
* **media:** cache cover art and derive an accent color ([7e9d064](https://github.com/MasRama/nokta/commit/7e9d06459a1d9eade706acaccf5a0cfb4255452c))
* **media:** follow MPRIS players over D-Bus and forward controls ([f551352](https://github.com/MasRama/nokta/commit/f5513528d47cf98a750bb29f9289e55b1a8e5b08))
* **media:** model MPRIS tracks and pick the active player ([2976f0a](https://github.com/MasRama/nokta/commit/2976f0a8dcceb8bf5e9583cf9426b6ac3ddf2f74))
* **settings:** load, validate and watch config.toml with safe fallback ([d20badf](https://github.com/MasRama/nokta/commit/d20badf715522807916748ee1abfc7c94731d85b))


### Bug Fixes

* **lyrics:** search LRCLIB directly for tracks longer than an hour ([5d7c24c](https://github.com/MasRama/nokta/commit/5d7c24c267e140e49305b86c52601384436501a7))
* **lyrics:** search LRCLIB when get is overloaded instead of failing ([0472e09](https://github.com/MasRama/nokta/commit/0472e09d0c131eae4a89f64fa79708e241d2827f))
* **media:** derive CanPlayPause from MPRIS CanPlay and CanPause ([e043bcf](https://github.com/MasRama/nokta/commit/e043bcfea718576ce6c3e93ffea26efd0e97a610))


### Performance Improvements

* **extension:** step the equalizer instead of easing it ([91c84fc](https://github.com/MasRama/nokta/commit/91c84fc7ba3c83a16884d8fb8a2e4a963e1e59da))
