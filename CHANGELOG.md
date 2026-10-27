# Changelog

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
