# Changelog

## [0.7.0](https://github.com/SirCypkowskyy/inwards/compare/v0.6.0...v0.7.0) (2026-10-11)


### Added

* **cli:** add inwards diagram to print the config as Mermaid or PlantUML ([#383](https://github.com/SirCypkowskyy/inwards/issues/383)) ([f83375a](https://github.com/SirCypkowskyy/inwards/commit/f83375a01a36c09536ed1bbaf0a0c46143db6260))
* **cli:** show diagram findings in the hook, the editor and MCP ([#385](https://github.com/SirCypkowskyy/inwards/issues/385)) ([06c400d](https://github.com/SirCypkowskyy/inwards/commit/06c400d6351a77d57e93086e534bbb8b9939caa9))
* **rules:** add INW019 diagram-missing-dependency ([#384](https://github.com/SirCypkowskyy/inwards/issues/384)) ([cdac53f](https://github.com/SirCypkowskyy/inwards/commit/cdac53f4da9187819e2c228ca21db8f01e9da064))
* **rules:** recognise FastAPI routers built at run time and in router factories ([#394](https://github.com/SirCypkowskyy/inwards/issues/394)) ([2008c3e](https://github.com/SirCypkowskyy/inwards/commit/2008c3eae67f49994628faa1e1976d3592de4083)), closes [#358](https://github.com/SirCypkowskyy/inwards/issues/358)
* **rules:** skip test modules in the opt-in content rules ([#389](https://github.com/SirCypkowskyy/inwards/issues/389)) ([a8c282a](https://github.com/SirCypkowskyy/inwards/commit/a8c282a42e93a0f43e2df33c55fcc7f9b8fc5d87))


### Fixed

* **rules:** report a project's own INW016 naming scheme once ([#390](https://github.com/SirCypkowskyy/inwards/issues/390)) ([0596d16](https://github.com/SirCypkowskyy/inwards/commit/0596d16713a99f0d4c3a65eff7d4bd9456e713d5)), closes [#361](https://github.com/SirCypkowskyy/inwards/issues/361)
* **rules:** stop INW012 flagging markup trees, HTMX error answers and health checks ([#396](https://github.com/SirCypkowskyy/inwards/issues/396)) ([cf127b7](https://github.com/SirCypkowskyy/inwards/commit/cf127b7397939c91f85158835964efebf5a08d31)), closes [#360](https://github.com/SirCypkowskyy/inwards/issues/360)


### Changed

* **rules:** parse each file once per run across the content rules ([#393](https://github.com/SirCypkowskyy/inwards/issues/393)) ([c38c5ae](https://github.com/SirCypkowskyy/inwards/commit/c38c5aececc57c14042f7efb8892d50e67fb10f3)), closes [#387](https://github.com/SirCypkowskyy/inwards/issues/387)
* **rules:** skip INW013 files that can't reach a blocking name in large runs ([#386](https://github.com/SirCypkowskyy/inwards/issues/386)) ([36acccc](https://github.com/SirCypkowskyy/inwards/commit/36acccc3a339ed74bec3efc4119d6eb21b13dd0a)), closes [#369](https://github.com/SirCypkowskyy/inwards/issues/369)


### Documentation

* show the rules as a category tree in the sidebar ([#382](https://github.com/SirCypkowskyy/inwards/issues/382)) ([223efd9](https://github.com/SirCypkowskyy/inwards/commit/223efd9a28c221cbc65d029229f005c47b70f95e)), closes [#381](https://github.com/SirCypkowskyy/inwards/issues/381)

## [0.6.0](https://github.com/SirCypkowskyy/inwards/compare/v0.5.0...v0.6.0) (2026-10-11)


### Added

* **cli:** add check --format github for Actions annotations ([#356](https://github.com/SirCypkowskyy/inwards/issues/356)) ([c7bb0bd](https://github.com/SirCypkowskyy/inwards/commit/c7bb0bd203700b36079ebc5eacfae03540edfc0c)), closes [#339](https://github.com/SirCypkowskyy/inwards/issues/339)
* **cli:** add init --agent claude --shared for committed hooks and MCP ([#357](https://github.com/SirCypkowskyy/inwards/issues/357)) ([7a7e187](https://github.com/SirCypkowskyy/inwards/commit/7a7e18721cd7f0e3de210485a2d228fd8fe6ad9f)), closes [#342](https://github.com/SirCypkowskyy/inwards/issues/342)
* **cli:** add inwards init --style auto that maps an existing project's packages ([#371](https://github.com/SirCypkowskyy/inwards/issues/371)) ([0cc09cb](https://github.com/SirCypkowskyy/inwards/commit/0cc09cbc3513adf91c79af9b25f1f42e20a08735)), closes [#343](https://github.com/SirCypkowskyy/inwards/issues/343)
* **cli:** add inwards rules and inwards rule CODE ([#355](https://github.com/SirCypkowskyy/inwards/issues/355)) ([ffd74dc](https://github.com/SirCypkowskyy/inwards/commit/ffd74dc31912150f588506adc9899b3675170999)), closes [#341](https://github.com/SirCypkowskyy/inwards/issues/341)
* **cli:** name the opt-in rules a project turns on in the architecture brief ([#352](https://github.com/SirCypkowskyy/inwards/issues/352)) ([bbb71a1](https://github.com/SirCypkowskyy/inwards/commit/bbb71a19d91e4845fa5a80d3436a3e90ace81559)), closes [#336](https://github.com/SirCypkowskyy/inwards/issues/336)
* **cli:** turn on INW014 ports-abstract in the clean and hexagonal presets ([#326](https://github.com/SirCypkowskyy/inwards/issues/326)) ([d05dd3f](https://github.com/SirCypkowskyy/inwards/commit/d05dd3fa39407a9391ab89b67af5f0f08309b603)), closes [#317](https://github.com/SirCypkowskyy/inwards/issues/317)
* **cli:** turn on INW015 construct-only-in in the clean and hexagonal presets ([#350](https://github.com/SirCypkowskyy/inwards/issues/350)) ([cf6746e](https://github.com/SirCypkowskyy/inwards/commit/cf6746e3772c137723c6e2e592eff04623c7908b)), closes [#325](https://github.com/SirCypkowskyy/inwards/issues/325)
* **cli:** turn on INW016 and keep fastapi out of the domain core in the fastapi preset ([#363](https://github.com/SirCypkowskyy/inwards/issues/363)) ([16b2f30](https://github.com/SirCypkowskyy/inwards/commit/16b2f3059695b9fa860ffd35bed396e42204ad6d)), closes [#338](https://github.com/SirCypkowskyy/inwards/issues/338)
* **cli:** turn on module cycles in every init preset ([#366](https://github.com/SirCypkowskyy/inwards/issues/366)) ([3f9cb26](https://github.com/SirCypkowskyy/inwards/commit/3f9cb26799fe5327f1b1754d6cf7462068763fcf)), closes [#340](https://github.com/SirCypkowskyy/inwards/issues/340)
* **core:** turn opt-in rules on per template role ([#327](https://github.com/SirCypkowskyy/inwards/issues/327)) ([5bdf5ad](https://github.com/SirCypkowskyy/inwards/commit/5bdf5ad0e70a53581793f7644a35acb327f1fad9)), closes [#298](https://github.com/SirCypkowskyy/inwards/issues/298)
* **rules:** add INW014 ports-abstract so port modules hold only ABCs and Protocols ([#312](https://github.com/SirCypkowskyy/inwards/issues/312)) ([05d95c1](https://github.com/SirCypkowskyy/inwards/commit/05d95c1f651af1b6071c09f59f8d020ae0cebe2e)), closes [#98](https://github.com/SirCypkowskyy/inwards/issues/98) [#295](https://github.com/SirCypkowskyy/inwards/issues/295)
* **rules:** add INW015 construct-only-in so only the composition root imports and builds outbound adapters ([#313](https://github.com/SirCypkowskyy/inwards/issues/313)) ([f385d41](https://github.com/SirCypkowskyy/inwards/commit/f385d4111a70f2be598c899d0627e58697b8e74b)), closes [#98](https://github.com/SirCypkowskyy/inwards/issues/98) [#296](https://github.com/SirCypkowskyy/inwards/issues/296)
* **rules:** add INW016 orm-naming for table names and datetime and date column suffixes ([#318](https://github.com/SirCypkowskyy/inwards/issues/318)) ([2331d42](https://github.com/SirCypkowskyy/inwards/commit/2331d427609aae1af7199288a192c6fdf8f7a1b0)), closes [#98](https://github.com/SirCypkowskyy/inwards/issues/98) [#297](https://github.com/SirCypkowskyy/inwards/issues/297)
* **rules:** add INW017 diagram-unknown-name for marked Mermaid architecture diagrams ([#354](https://github.com/SirCypkowskyy/inwards/issues/354)) ([ab81e69](https://github.com/SirCypkowskyy/inwards/commit/ab81e69d56fd64ecec1a75008ac6bf5470a14404))
* **rules:** add INW018 diagram-forbidden-edge and inwards import-diagram ([#365](https://github.com/SirCypkowskyy/inwards/issues/365)) ([bfb6a9f](https://github.com/SirCypkowskyy/inwards/commit/bfb6a9f8eb1c3299f9bd2a307d72445be41e950e)), closes [#332](https://github.com/SirCypkowskyy/inwards/issues/332) [#345](https://github.com/SirCypkowskyy/inwards/issues/345)
* **rules:** read PlantUML component diagrams in INW017, INW018 and import-diagram ([#373](https://github.com/SirCypkowskyy/inwards/issues/373)) ([6d3ea63](https://github.com/SirCypkowskyy/inwards/commit/6d3ea6312fb9aa7ec1f96f8810fc97a43c87960b)), closes [#332](https://github.com/SirCypkowskyy/inwards/issues/332) [#346](https://github.com/SirCypkowskyy/inwards/issues/346)


### Fixed

* **cli:** give every command its own --help and one-line usage errors ([#351](https://github.com/SirCypkowskyy/inwards/issues/351)) ([f316ca3](https://github.com/SirCypkowskyy/inwards/commit/f316ca312528573f973eb55792cf74b16329c5e0)), closes [#335](https://github.com/SirCypkowskyy/inwards/issues/335)
* **rules:** cut false positives of the opt-in rules found on the corpus ([#364](https://github.com/SirCypkowskyy/inwards/issues/364)) ([a99ea2a](https://github.com/SirCypkowskyy/inwards/commit/a99ea2a9e33306e708b26dd6a5df1f59878823bb)), closes [#182](https://github.com/SirCypkowskyy/inwards/issues/182)
* **rules:** don't count TYPE_CHECKING imports as INW004 cycle edges ([#376](https://github.com/SirCypkowskyy/inwards/issues/376)) ([7897c79](https://github.com/SirCypkowskyy/inwards/commit/7897c79a61513627bb2c826d02372ccc12d5aa1b))
* **rules:** report correct end positions for INW016 findings ([#374](https://github.com/SirCypkowskyy/inwards/issues/374)) ([67a4311](https://github.com/SirCypkowskyy/inwards/commit/67a431156eb1944d1f73a4437332034076613261)), closes [#370](https://github.com/SirCypkowskyy/inwards/issues/370)


### Changed

* **rules:** parse each module INW013 follows once per run ([#372](https://github.com/SirCypkowskyy/inwards/issues/372)) ([48cbce7](https://github.com/SirCypkowskyy/inwards/commit/48cbce77215936ab5d5ef00e230af84fdb60c2a6)), closes [#359](https://github.com/SirCypkowskyy/inwards/issues/359)


### Documentation

* add a getting-started guide for GitHub Copilot ([#314](https://github.com/SirCypkowskyy/inwards/issues/314)) ([71534ef](https://github.com/SirCypkowskyy/inwards/commit/71534ef014fdd420a98c0e624d1e593e986f8503)), closes [#67](https://github.com/SirCypkowskyy/inwards/issues/67)
* add setup pages for Neovim, Zed and Helix ([#311](https://github.com/SirCypkowskyy/inwards/issues/311)) ([92e27cc](https://github.com/SirCypkowskyy/inwards/commit/92e27ccc2c3969803b50a62833cf9ec88c2ed4ee)), closes [#66](https://github.com/SirCypkowskyy/inwards/issues/66)
* decide Inwards hooks for Copilot in ADR-044 ([#324](https://github.com/SirCypkowskyy/inwards/issues/324)) ([46fee50](https://github.com/SirCypkowskyy/inwards/commit/46fee5065605be1ea7d50da81d0a711e0e7d8da0)), closes [#316](https://github.com/SirCypkowskyy/inwards/issues/316)
* point install and CI at PyPI and the public repository ([#353](https://github.com/SirCypkowskyy/inwards/issues/353)) ([2b06d29](https://github.com/SirCypkowskyy/inwards/commit/2b06d29c869d976fb81318820b3e35d0a430cc24)), closes [#334](https://github.com/SirCypkowskyy/inwards/issues/334)
* **rules:** group the rule catalogue by category and show presets ([#368](https://github.com/SirCypkowskyy/inwards/issues/368)) ([5ab4ff8](https://github.com/SirCypkowskyy/inwards/commit/5ab4ff8c421b60f71e1c41f03b8b79c5349f8d2a)), closes [#337](https://github.com/SirCypkowskyy/inwards/issues/337)

## [0.5.0](https://github.com/SirCypkowskyy/inwards/compare/v0.4.0...v0.5.0) (2026-10-10)


### Added

* **cli:** add `inwards mcp`, an MCP server for checking code before it is written ([#307](https://github.com/SirCypkowskyy/inwards/issues/307)) ([2c15753](https://github.com/SirCypkowskyy/inwards/commit/2c15753a3fe4683d38a62ad0b9ec0db5daccbb01)), closes [#65](https://github.com/SirCypkowskyy/inwards/issues/65)
* **cli:** add `inwards server`, a language server over stdio in the binary ([#300](https://github.com/SirCypkowskyy/inwards/issues/300)) ([d170ae5](https://github.com/SirCypkowskyy/inwards/commit/d170ae5978f807ea13cec8742603adcd2a6be383)), closes [#63](https://github.com/SirCypkowskyy/inwards/issues/63)
* **cli:** add the fastapi preset to inwards init --style ([#269](https://github.com/SirCypkowskyy/inwards/issues/269)) ([77cb4a0](https://github.com/SirCypkowskyy/inwards/commit/77cb4a0b31667d06de72400af2a69d8af8c98b13)), closes [#238](https://github.com/SirCypkowskyy/inwards/issues/238)
* **cli:** map import-linter | siblings to sibling layer groups ([#254](https://github.com/SirCypkowskyy/inwards/issues/254)) ([d2ecd05](https://github.com/SirCypkowskyy/inwards/commit/d2ecd053064b85e5eafb7f323c68802035ac7913))
* **cli:** serve PostToolUse from a resident inwards daemon ([#274](https://github.com/SirCypkowskyy/inwards/issues/274)) ([05b7186](https://github.com/SirCypkowskyy/inwards/commit/05b7186ebfdde00b107f8b219b25c423bfd8168f)), closes [#60](https://github.com/SirCypkowskyy/inwards/issues/60)
* **cli:** turn on INW012 thin-endpoint in the fastapi preset ([#283](https://github.com/SirCypkowskyy/inwards/issues/283)) ([08ad7c4](https://github.com/SirCypkowskyy/inwards/commit/08ad7c49feacf8fa6941af567a6ca57fb31ad52b)), closes [#272](https://github.com/SirCypkowskyy/inwards/issues/272)
* **cli:** turn on INW013 async-blocking in the fastapi preset ([#303](https://github.com/SirCypkowskyy/inwards/issues/303)) ([b3a030c](https://github.com/SirCypkowskyy/inwards/commit/b3a030c7481a851f0daf01c3e654201fba96ac8e)), closes [#302](https://github.com/SirCypkowskyy/inwards/issues/302)
* **rules:** add FAPI005 route-shadowing ([#256](https://github.com/SirCypkowskyy/inwards/issues/256)) ([bbefe6e](https://github.com/SirCypkowskyy/inwards/commit/bbefe6eff0bb5f904185d825b030f5f36da4f0a8))
* **rules:** add FAPI006 to FAPI009 (lifespan-events, yield-dependency-swallows, duplicate-operation-id, depends-called) ([#260](https://github.com/SirCypkowskyy/inwards/issues/260)) ([ce385f8](https://github.com/SirCypkowskyy/inwards/commit/ce385f8dd6f2a337d3fdd79282908d63faf0f9e6)), closes [#225](https://github.com/SirCypkowskyy/inwards/issues/225) [#226](https://github.com/SirCypkowskyy/inwards/issues/226) [#227](https://github.com/SirCypkowskyy/inwards/issues/227) [#228](https://github.com/SirCypkowskyy/inwards/issues/228)
* **rules:** add INW012 thin-endpoint for FastAPI endpoints and custom decorators ([#273](https://github.com/SirCypkowskyy/inwards/issues/273)) ([c9eb992](https://github.com/SirCypkowskyy/inwards/commit/c9eb99216403fe5e2c09cfe9b6f8e1b6c6f06c11)), closes [#182](https://github.com/SirCypkowskyy/inwards/issues/182)
* **rules:** add INW013 async-blocking for sync database, cache and cloud calls in async def ([#301](https://github.com/SirCypkowskyy/inwards/issues/301)) ([a8ef8ce](https://github.com/SirCypkowskyy/inwards/commit/a8ef8cef2a41fe21b210d14a832a207ebace5cac)), closes [#98](https://github.com/SirCypkowskyy/inwards/issues/98) [#293](https://github.com/SirCypkowskyy/inwards/issues/293)
* **rules:** count same-module helpers and registered routes in INW012 ([#287](https://github.com/SirCypkowskyy/inwards/issues/287)) ([4db9576](https://github.com/SirCypkowskyy/inwards/commit/4db95767f19fb4c5b0266fa810b5829aa220c306)), closes [#271](https://github.com/SirCypkowskyy/inwards/issues/271)
* **rules:** deny a library to a module prefix with INW005's deny option ([#245](https://github.com/SirCypkowskyy/inwards/issues/245)) ([6efa426](https://github.com/SirCypkowskyy/inwards/commit/6efa4269e4f212a216f58c9c551881a530faee09)), closes [#219](https://github.com/SirCypkowskyy/inwards/issues/219)
* **rules:** follow INW013 one hop into first-party sync helpers ([#304](https://github.com/SirCypkowskyy/inwards/issues/304)) ([214e95b](https://github.com/SirCypkowskyy/inwards/commit/214e95b95b038df36d0d31b185e277aa06f30708)), closes [#98](https://github.com/SirCypkowskyy/inwards/issues/98) [#294](https://github.com/SirCypkowskyy/inwards/issues/294)
* **rules:** let a context's public list open a package facade with =pkg ([#259](https://github.com/SirCypkowskyy/inwards/issues/259)) ([79a2413](https://github.com/SirCypkowskyy/inwards/commit/79a241371e69943f0cb031d3bc5d6eda2b2894aa))
* **rules:** name the concrete delegate-to module in INW012 fixes ([#288](https://github.com/SirCypkowskyy/inwards/issues/288)) ([337fc66](https://github.com/SirCypkowskyy/inwards/commit/337fc66629996091ecdfb9f52e216804d28d54df))
* **rules:** read looped and splatted FAPI002 handler registrations, scope them per app ([#264](https://github.com/SirCypkowskyy/inwards/issues/264)) ([f2c266b](https://github.com/SirCypkowskyy/inwards/commit/f2c266b3019446dab7163ce84780b04fbd540641)), closes [#242](https://github.com/SirCypkowskyy/inwards/issues/242)
* **rules:** recognise Flask, Litestar and Django endpoints in INW012 ([#291](https://github.com/SirCypkowskyy/inwards/issues/291)) ([e4d188b](https://github.com/SirCypkowskyy/inwards/commit/e4d188bb8f52a5f9c5e5279245e9a967afa7b952)), closes [#270](https://github.com/SirCypkowskyy/inwards/issues/270)
* **vscode:** start the bundled `inwards server` and publish to the Marketplace and Open VSX ([#306](https://github.com/SirCypkowskyy/inwards/issues/306)) ([0bda609](https://github.com/SirCypkowskyy/inwards/commit/0bda6093fe961ba1d699ae45a1a75f6d9c115589)), closes [#64](https://github.com/SirCypkowskyy/inwards/issues/64)


### Fixed

* **cli:** don't let a reused pid keep a dead daemon's lock ([#285](https://github.com/SirCypkowskyy/inwards/issues/285)) ([363b6c1](https://github.com/SirCypkowskyy/inwards/commit/363b6c1dff183cb05fff0fd61363c66a14343a75)), closes [#276](https://github.com/SirCypkowskyy/inwards/issues/276)
* **cli:** keep a hung git call from blocking the daemon's queue ([#290](https://github.com/SirCypkowskyy/inwards/issues/290)) ([ec2bd65](https://github.com/SirCypkowskyy/inwards/commit/ec2bd65bd38731676a82ad30a3497384b9ac180c)), closes [#277](https://github.com/SirCypkowskyy/inwards/issues/277)
* **cli:** make SessionStart start-content copies on Windows ([#253](https://github.com/SirCypkowskyy/inwards/issues/253)) ([1d976eb](https://github.com/SirCypkowskyy/inwards/commit/1d976eb4b86367593fdade9e1896da74ab0a00bb))
* **cli:** stop starting a daemon on every edit when none can listen ([#289](https://github.com/SirCypkowskyy/inwards/issues/289)) ([b6358f9](https://github.com/SirCypkowskyy/inwards/commit/b6358f989542a52a759eb04a5535491a0aceab70)), closes [#275](https://github.com/SirCypkowskyy/inwards/issues/275)


### Changed

* **cli:** cut the serial part of a cold full check ([#292](https://github.com/SirCypkowskyy/inwards/issues/292)) ([c3ef8f3](https://github.com/SirCypkowskyy/inwards/commit/c3ef8f305fa6faa90b30096697800eeeb20e2de1)), closes [#281](https://github.com/SirCypkowskyy/inwards/issues/281)
* **cli:** parse large full checks on worker threads ([#282](https://github.com/SirCypkowskyy/inwards/issues/282)) ([3dc5489](https://github.com/SirCypkowskyy/inwards/commit/3dc54899c28709275a1bdbe210d9028ce82b23d0)), closes [#61](https://github.com/SirCypkowskyy/inwards/issues/61)
* **core:** blank long runs of comment lines before the full parse ([#255](https://github.com/SirCypkowskyy/inwards/issues/255)) ([2fd428c](https://github.com/SirCypkowskyy/inwards/commit/2fd428cf09929f7472157706fa37afdf5099f602))
* **core:** parse the hook's second check of a file incrementally ([#299](https://github.com/SirCypkowskyy/inwards/issues/299)) ([5411f97](https://github.com/SirCypkowskyy/inwards/commit/5411f97425ee8c6c65cf6fc21393315d05f696e2)), closes [#122](https://github.com/SirCypkowskyy/inwards/issues/122)
* **core:** read imports and suppression comments without walking the whole tree ([#268](https://github.com/SirCypkowskyy/inwards/issues/268)) ([5bfad70](https://github.com/SirCypkowskyy/inwards/commit/5bfad70b4e1c0e033278418458608e2a396b4c02)), closes [#62](https://github.com/SirCypkowskyy/inwards/issues/62)


### Documentation

* decide the resident process design in ADR-039 ([#263](https://github.com/SirCypkowskyy/inwards/issues/263)) ([73936df](https://github.com/SirCypkowskyy/inwards/commit/73936df6ec7dcb908ef96cd415b027350691619b)), closes [#59](https://github.com/SirCypkowskyy/inwards/issues/59)
* give the docs site its own identity and a home page built on a real run ([#250](https://github.com/SirCypkowskyy/inwards/issues/250)) ([dc93f8a](https://github.com/SirCypkowskyy/inwards/commit/dc93f8a70d1db10e8c157372cbc0511657909c32))
* point editor completion at SchemaStore and add the schema sync step ([#249](https://github.com/SirCypkowskyy/inwards/issues/249)) ([9c0bc74](https://github.com/SirCypkowskyy/inwards/commit/9c0bc74dafe1e0ca83b79e875f37f3544cf0aec1))
* **rules:** validate rule pages and add a filterable rule list ([#265](https://github.com/SirCypkowskyy/inwards/issues/265)) ([df00f56](https://github.com/SirCypkowskyy/inwards/commit/df00f56d022784923cab4b6c2e3adaea5c368c0e)), closes [#145](https://github.com/SirCypkowskyy/inwards/issues/145)

## [0.4.0](https://github.com/SirCypkowskyy/inwards/compare/v0.3.1...v0.4.0) (2026-09-28)


### Added

* check every uv workspace member with its own config, and find namespace package portions in other members ([#217](https://github.com/SirCypkowskyy/inwards/issues/217)) ([8dbf052](https://github.com/SirCypkowskyy/inwards/commit/8dbf0529ebf964afa3fea8638e757d33fd9d5b5b))
* **cli:** add vertical-slices, bounded-contexts and django presets, and make hexagonal adapters siblings ([#239](https://github.com/SirCypkowskyy/inwards/issues/239)) ([455ac94](https://github.com/SirCypkowskyy/inwards/commit/455ac94b2d3e373fc1a04c696d254b5ae27b1442))
* **cli:** brief the agent on the architecture with inwards context and init --brief ([#213](https://github.com/SirCypkowskyy/inwards/issues/213)) ([2f590de](https://github.com/SirCypkowskyy/inwards/commit/2f590de93a40401536d8daddf6da7d2d6106d531))
* **cli:** convert import-linter contracts with inwards import-config ([#220](https://github.com/SirCypkowskyy/inwards/issues/220)) ([3949a5b](https://github.com/SirCypkowskyy/inwards/commit/3949a5b73ca8d755ecbaaeb40d7626cf8f6d94a6))
* **cli:** write package shapes with init --style --scaffold ([#218](https://github.com/SirCypkowskyy/inwards/issues/218)) ([0ecc210](https://github.com/SirCypkowskyy/inwards/commit/0ecc2106917e8094dc24f3b7ab575a3d1cc92e77))
* **config:** layer selectors such as shop.*.domain for vertical slices ([#222](https://github.com/SirCypkowskyy/inwards/issues/222)) ([68e66be](https://github.com/SirCypkowskyy/inwards/commit/68e66be1b95a4f1c17c6fc1eff48f0aeaf624069))
* **config:** opt-in rules, extend-select and per-rule option tables ([#223](https://github.com/SirCypkowskyy/inwards/issues/223)) ([e87e464](https://github.com/SirCypkowskyy/inwards/commit/e87e4646670c8343d0f5b44bfea06b1b74d067c2))
* **config:** package templates with role layering and independent sibling layers ([#232](https://github.com/SirCypkowskyy/inwards/issues/232)) ([80c75ad](https://github.com/SirCypkowskyy/inwards/commit/80c75ad2e0e345f1feb0dc85c1199989bfa22d11))
* **hook:** deny a Write that creates a Python file the package shape forbids ([#215](https://github.com/SirCypkowskyy/inwards/issues/215)) ([44f494a](https://github.com/SirCypkowskyy/inwards/commit/44f494a0a79344ac2ff987712efc96da5eb02cb3))
* **hook:** know the start content of files dirty or untracked at session start ([#229](https://github.com/SirCypkowskyy/inwards/issues/229)) ([a9f854d](https://github.com/SirCypkowskyy/inwards/commit/a9f854d33fcb3981d4b3f7a9a58258ed7381dff1))
* **rules:** add FAPI001 endpoint-metadata and FAPI002 undocumented-error-response ([#243](https://github.com/SirCypkowskyy/inwards/issues/243)) ([d4b94ea](https://github.com/SirCypkowskyy/inwards/commit/d4b94ea27ec7e46d77bfa785e8d2110d97a4a572))
* **rules:** FAPI003 router-wiring reports unmounted routers, inclusion cycles and early includes ([#237](https://github.com/SirCypkowskyy/inwards/issues/237)) ([188c201](https://github.com/SirCypkowskyy/inwards/commit/188c201659b4fc8f14e6e036c0d24532d9b0a769))
* **rules:** follow more loader routes and fold constant targets in INW011 ([#216](https://github.com/SirCypkowskyy/inwards/issues/216)) ([cfbd1ab](https://github.com/SirCypkowskyy/inwards/commit/cfbd1abe96392deb9db810fc04b8d24573c314ed))
* **rules:** register the FastAPI rule family (FAPI001-FAPI003, opt-in) and its shared model ([#230](https://github.com/SirCypkowskyy/inwards/issues/230)) ([a735af0](https://github.com/SirCypkowskyy/inwards/commit/a735af0cf560d2920f962e2696ea20cb7fcc83de))


### Fixed

* **cli:** report a --config that isn't a file instead of crashing ([#214](https://github.com/SirCypkowskyy/inwards/issues/214)) ([8e21ec3](https://github.com/SirCypkowskyy/inwards/commit/8e21ec36bcbca35a99b76d2526d3cd82e8e348a1))
* **hook:** catch a replayed SessionStart and a Stop hook removed through Bash ([#240](https://github.com/SirCypkowskyy/inwards/issues/240)) ([9f25ba2](https://github.com/SirCypkowskyy/inwards/commit/9f25ba2b35997dd23ea92632aadf69a77d2228a5))
* **hook:** show what a Bash edit of [tool.inwards] hides by checking with the session-start config ([#211](https://github.com/SirCypkowskyy/inwards/issues/211)) ([c9981c4](https://github.com/SirCypkowskyy/inwards/commit/c9981c44cd6a965396508c1ed8e1056d7bef9ad2))
* **rules:** accept namespace package portions installed in the project's .venv, or listed in namespace-packages ([#221](https://github.com/SirCypkowskyy/inwards/issues/221)) ([164f5b0](https://github.com/SirCypkowskyy/inwards/commit/164f5b0ad3195006333abed85a0325c715e3c64b))
* **rules:** close the INW006 follow-ups for compiled modules, ignore depth and shadowing packages ([#244](https://github.com/SirCypkowskyy/inwards/issues/244)) ([59b52a1](https://github.com/SirCypkowskyy/inwards/commit/59b52a1db9196b9ebb77667d69cff1e772ccc3c7))
* **rules:** report symlinks in layers that point out of the root or into another layer ([#231](https://github.com/SirCypkowskyy/inwards/issues/231)) ([d9a7670](https://github.com/SirCypkowskyy/inwards/commit/d9a76704f6bb6320e3d40067c6c156ed74685e74))


### Documentation

* **spike:** record the FAPI004 corpus run and its no-go per subset ([#241](https://github.com/SirCypkowskyy/inwards/issues/241)) ([8c46281](https://github.com/SirCypkowskyy/inwards/commit/8c4628186137612e4e3702a68771c387c39f808d))


### Chores

* promote develop to main ([#247](https://github.com/SirCypkowskyy/inwards/issues/247)) ([0251bfc](https://github.com/SirCypkowskyy/inwards/commit/0251bfc1689b7144e10f456699487c3da7d3fb0d))

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
