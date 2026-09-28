# Changelog

## [0.3.1](https://github.com/SirCypkowskyy/inwards/compare/v0.3.0...v0.3.1) (2026-09-28)


### Added

* a content-keyed extraction cache for check and baseline ([#194](https://github.com/SirCypkowskyy/inwards/issues/194)) ([e478c15](https://github.com/SirCypkowskyy/inwards/commit/e478c1560364a8697359b24d87e47aedcd026aa5))
* **cli:** init --launcher "uv run" writes hooks and the AGENTS.md command without a binary path ([#207](https://github.com/SirCypkowskyy/inwards/issues/207)) ([4df19d7](https://github.com/SirCypkowskyy/inwards/commit/4df19d7dbb17780d096e5386d8678168e79c5be5))
* **cli:** inwards init --agent opencode wires Inwards into OpenCode ([#199](https://github.com/SirCypkowskyy/inwards/issues/199)) ([32e6460](https://github.com/SirCypkowskyy/inwards/commit/32e6460ac75841c9fdc55588b1826b923b2cd813))
* **config:** contexts table, a JSON Schema and a configuration reference ([#193](https://github.com/SirCypkowskyy/inwards/issues/193)) ([c4d5f8f](https://github.com/SirCypkowskyy/inwards/commit/c4d5f8fe85cb5c635357f9b45ca00a9bf0149334))
* **rules:** call a uv workspace member a workspace package in INW005 ([#204](https://github.com/SirCypkowskyy/inwards/issues/204)) ([1c98fe6](https://github.com/SirCypkowskyy/inwards/commit/1c98fe6f97527ee44171d644990cc954ab1f5efa))
* **rules:** INW002 keeps each bounded context to the contexts it depends on ([#195](https://github.com/SirCypkowskyy/inwards/issues/195)) ([e839c3e](https://github.com/SirCypkowskyy/inwards/commit/e839c3e68d1d709bd559519fe7d5657a940102fd))
* **rules:** INW003 keeps code outside a context to its public modules ([#196](https://github.com/SirCypkowskyy/inwards/issues/196)) ([76635a3](https://github.com/SirCypkowskyy/inwards/commit/76635a3470f14887abcb7863529d373cb01b5f02))
* **rules:** INW004 reports import cycles between modules or contexts ([#197](https://github.com/SirCypkowskyy/inwards/issues/197)) ([ae212d2](https://github.com/SirCypkowskyy/inwards/commit/ae212d21b78283a5e98fab7bf5e5b186c567e147))


### Fixed

* **cli:** warn about check paths outside the config root instead of reporting All clear ([#205](https://github.com/SirCypkowskyy/inwards/issues/205)) ([7906bb4](https://github.com/SirCypkowskyy/inwards/commit/7906bb4565c854c1e67bafb5ff3a3cc7c133609d))
* **rules:** warn when a uv workspace member is checked from the workspace root ([#206](https://github.com/SirCypkowskyy/inwards/issues/206)) ([b8c0ea7](https://github.com/SirCypkowskyy/inwards/commit/b8c0ea778dbb113b1371b1c032fbe01570695b04))


### Documentation

* describe CI's self-hosted part without naming the infrastructure ([#198](https://github.com/SirCypkowskyy/inwards/issues/198)) ([f3b77cd](https://github.com/SirCypkowskyy/inwards/commit/f3b77cdc38614bc92a01836eb2d2d19e57178a1d))

## [0.3.0](https://github.com/SirCypkowskyy/inwards/compare/v0.2.0...v0.3.0) (2026-09-27)


### ⚠ BREAKING CHANGES

* **rules:** a dynamic import whose target isn't a string literal (`importlib.import_module(name)`, `exec(code)`, …) in any layer but the outermost now fails `inwards check` (INW011). Use a literal or an import statement, move the loader to the outermost layer and pass what it loads in through a Protocol-typed parameter, or baseline it.
* **rules:** a layered file that imports a first-party module that doesn't exist now fails `inwards check` (INW010). Fix the import, create the module, or run `inwards baseline`.
* **rules:** in a config with two or more layers, the innermost layer now denies 32 frameworks, database and network clients and standard-library I/O modules by default (INW005), so a domain that imports one of them, such as `sqlalchemy`, `requests` or `subprocess`, fails `inwards check` after the upgrade. Move the import behind a port implemented in an outer layer, set `deny-libraries = []` on the innermost layer to turn the default off, or run `inwards baseline` to accept the existing imports.

### Added

* **config:** add extend-deny-libraries to add to the INW005 deny list instead of replacing it ([#166](https://github.com/SirCypkowskyy/inwards/issues/166)) ([b7bfa3b](https://github.com/SirCypkowskyy/inwards/commit/b7bfa3b8fd09b778945d0fe012713d7b8dc878db))
* **config:** let INW010 accept generated modules missing from a fresh checkout ([#172](https://github.com/SirCypkowskyy/inwards/issues/172)) ([943d227](https://github.com/SirCypkowskyy/inwards/commit/943d227462d91c298094dc3023b13716dd807316))
* **config:** per-rule select, ignore and severity in [tool.inwards.rules] ([#162](https://github.com/SirCypkowskyy/inwards/issues/162)) ([f78d2fd](https://github.com/SirCypkowskyy/inwards/commit/f78d2fd3ba1c1620e184894ec700f1991558a393))
* **core:** make the module index an engine input for every adapter ([#153](https://github.com/SirCypkowskyy/inwards/issues/153)) ([8a40b82](https://github.com/SirCypkowskyy/inwards/commit/8a40b8219140731a7d52d445f15df150c4a5827a))
* **lsp:** show config errors in the editor and re-read pyproject.toml on change ([#167](https://github.com/SirCypkowskyy/inwards/issues/167)) ([c6013c7](https://github.com/SirCypkowskyy/inwards/commit/c6013c72f9fbb7714ba4af117d5d4f9d1580f09f))
* **rules:** add INW005 to limit the libraries each layer may import ([#151](https://github.com/SirCypkowskyy/inwards/issues/151)) ([2a5cff1](https://github.com/SirCypkowskyy/inwards/commit/2a5cff151ef63401676fbd2d16aa1c3a84caeda9))
* **rules:** add INW010 to flag imports of first-party modules that don't exist ([#159](https://github.com/SirCypkowskyy/inwards/issues/159)) ([859a85d](https://github.com/SirCypkowskyy/inwards/commit/859a85d95f509e3079e7bfc9cec92655416c3535))
* **rules:** inline suppressions with a mandatory reason, rejected by default when an agent adds them ([#165](https://github.com/SirCypkowskyy/inwards/issues/165)) ([f75f47f](https://github.com/SirCypkowskyy/inwards/commit/f75f47f1c1acb130383633d9af8481050fa267b9))
* **rules:** link each diagnostic to its own rule page, with a docs page per rule ([#173](https://github.com/SirCypkowskyy/inwards/issues/173)) ([5712650](https://github.com/SirCypkowskyy/inwards/commit/57126503bb362657dc65e9f7e03042a10d04f0ba))
* **rules:** report dynamic imports with unverifiable targets in inner layers (INW011) ([#158](https://github.com/SirCypkowskyy/inwards/issues/158)) ([492e8fc](https://github.com/SirCypkowskyy/inwards/commit/492e8fc178ce418ae04514b4bba543151638c97f))


### Fixed

* **ci:** cycle check and run-log test on macOS and Windows ([#187](https://github.com/SirCypkowskyy/inwards/issues/187)) ([d7bf6f8](https://github.com/SirCypkowskyy/inwards/commit/d7bf6f8445e6f9929bf0340aff8ab784f90a6af1))
* **hook:** let read-only Bash chains and pipelines that name .inwards through the config guard ([#152](https://github.com/SirCypkowskyy/inwards/issues/152)) ([1e267e8](https://github.com/SirCypkowskyy/inwards/commit/1e267e8dc2be3ded0dd4c8aa2e12e6e15f4cf2cf))
* **hooks:** show project-relative paths through a symlinked root, and run doc snippets under bash 3.2 ([#175](https://github.com/SirCypkowskyy/inwards/issues/175)) ([8717831](https://github.com/SirCypkowskyy/inwards/commit/871783194bea6d56590cb3928174d903d9ffaa33))
* **hooks:** stop INW007's pre-existing excuse from following symlink aliases ([#171](https://github.com/SirCypkowskyy/inwards/issues/171)) ([fb1f498](https://github.com/SirCypkowskyy/inwards/commit/fb1f498ca8b5f9dbccc3e2dbed0b02145de32209))
* **hook:** stop blocking on violations a file already had at session start ([#154](https://github.com/SirCypkowskyy/inwards/issues/154)) ([6ae458b](https://github.com/SirCypkowskyy/inwards/commit/6ae458bdd5f00f190c8b488e24f06170079e07d7))


### Documentation

* add a Polish translation at /pl/ with a page-keeping language switcher ([#156](https://github.com/SirCypkowskyy/inwards/issues/156)) ([7564422](https://github.com/SirCypkowskyy/inwards/commit/7564422d0d08dca29f85374cc932cb7f229a1b80))
* drop the CI runners section from chapter 6 ([#148](https://github.com/SirCypkowskyy/inwards/issues/148)) ([7765501](https://github.com/SirCypkowskyy/inwards/commit/7765501d53cbd12dcb554d717a528c56de4a186f))


### Chores

* promote develop to main ([#189](https://github.com/SirCypkowskyy/inwards/issues/189)) ([b007403](https://github.com/SirCypkowskyy/inwards/commit/b007403b62475af4bf5e14b225145573b0cc65c4))

## [0.2.0](https://github.com/SirCypkowskyy/inwards/compare/v0.1.0...v0.2.0) (2026-09-26)


### Added

* **cli:** add --format concise and --max-diagnostics ([#117](https://github.com/SirCypkowskyy/inwards/issues/117)) ([1b13098](https://github.com/SirCypkowskyy/inwards/commit/1b1309848117f59e94ffcd4036c350c14e13a643))
* **cli:** design-partner kit: guide, stats --export --redact, feedback form ([#128](https://github.com/SirCypkowskyy/inwards/issues/128)) ([c1b831a](https://github.com/SirCypkowskyy/inwards/commit/c1b831a7864f079850d2a7cfe4328a08e1cc3a41))
* **cli:** inwards baseline accepts existing violations ([#105](https://github.com/SirCypkowskyy/inwards/issues/105)) ([7da0555](https://github.com/SirCypkowskyy/inwards/commit/7da0555ba6566e44d23a4d91f8fa2d539578d0da))
* **cli:** inwards init --style writes architecture presets, with an example scaffold and a picker ([#125](https://github.com/SirCypkowskyy/inwards/issues/125)) ([fb3aeea](https://github.com/SirCypkowskyy/inwards/commit/fb3aeea01c775a5409d44e9a6d64b4f244e3f459))
* **cli:** inwards stats computes the hypothesis numbers from the run log ([#110](https://github.com/SirCypkowskyy/inwards/issues/110)) ([6e46e39](https://github.com/SirCypkowskyy/inwards/commit/6e46e3986e53921d6c49d0514d9f2348545209a5))
* **rules:** package shape with INW007 package-shape and INW008 missing-member ([#123](https://github.com/SirCypkowskyy/inwards/issues/123)) ([954671f](https://github.com/SirCypkowskyy/inwards/commit/954671fc10b5a9b4cdc17af588e5063699c59a0c))


### Fixed

* **cli:** stats handles parallel sessions, stubs and projects outside git ([#115](https://github.com/SirCypkowskyy/inwards/issues/115)) ([87ccc6d](https://github.com/SirCypkowskyy/inwards/commit/87ccc6db73f66dbe448ad925f989d8cc3569b8b3))
* **docs:** quadrant chart and C1-C4 text unreadable in light theme ([#140](https://github.com/SirCypkowskyy/inwards/issues/140)) ([63a05df](https://github.com/SirCypkowskyy/inwards/commit/63a05dfa1687199e7ccd2983ce921b1697d49d97))


### Changed

* compile the binaries with bytecode to halve start-up ([#118](https://github.com/SirCypkowskyy/inwards/issues/118)) ([f2f5325](https://github.com/SirCypkowskyy/inwards/commit/f2f53255b9edb4465c4d609af72bacd54309ce8c))
* skip the confirming parse for baselined violations and add a whole-project Stop gate ([#139](https://github.com/SirCypkowskyy/inwards/issues/139)) ([fb741b1](https://github.com/SirCypkowskyy/inwards/commit/fb741b1a40204efb81baa1381c30c7624591bfe9))


### Documentation

* **agents:** claim issues through linked branches and close them with a full report ([#116](https://github.com/SirCypkowskyy/inwards/issues/116)) ([6386972](https://github.com/SirCypkowskyy/inwards/commit/63869728ef7eb05a3d32840b94fd7fefa49d0fbb))
* bring the docs in line with what M1 shipped ([#104](https://github.com/SirCypkowskyy/inwards/issues/104)) ([98acd0e](https://github.com/SirCypkowskyy/inwards/commit/98acd0ebf53ff9b19674f51e26ab60410a0a8dc4))
* fix diagram theming for dark mode, animate the homepage loop ([#130](https://github.com/SirCypkowskyy/inwards/issues/130)) ([c90a58c](https://github.com/SirCypkowskyy/inwards/commit/c90a58cf5acd990b865263e47a228ee784f5dc92))
* record the M2 go or no-go decision (ADR-022) ([#137](https://github.com/SirCypkowskyy/inwards/issues/137)) ([b9b5c23](https://github.com/SirCypkowskyy/inwards/commit/b9b5c23f3ff3ac837d464f7f6e110ea3a8db2ba7))


### Chores

* promote develop to main ([#146](https://github.com/SirCypkowskyy/inwards/issues/146)) ([3b43546](https://github.com/SirCypkowskyy/inwards/commit/3b4354672b30af92f8af2df5c058b9c8919b3d2d))
