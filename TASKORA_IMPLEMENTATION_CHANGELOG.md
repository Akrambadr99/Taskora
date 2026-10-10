# Taskora implementation changelog

Base: `02ef05c956f691d1ee15ed6f5c7b4091bf071a34`. All commits are local, current-dated and disclose AI assistance. No history rewrite.

## 7edefb213e802d6e7d4ed603393208bdb56ff80a

fix: enforce project membership snapshot integrity

Files:

- `src/data/project-membership-integrity.test.ts`
- `src/data/snapshot-validation.ts`

## 49894a6efde47c19f10deb0b8ad257ecc5147438

test: await command palette route reconciliation

Files:

- `src/features/commands/CommandPalette.test.tsx`

## 2223428399661b6afe6a76030cb4985e4060e70b

fix: update vulnerable test tooling dependencies

Files:

- `package-lock.json`
- `package.json`

## 23488704d65090cf57eae88f9f1a8582ea41b71d

docs: retain dependency and scaffold license notices

Files:

- `.gitattributes`
- `THIRD_PARTY_NOTICES.md`
- `docs/third-party/create-vite-9.1.2-LICENSE.txt`
- `docs/third-party/inventory.json`
- `docs/third-party/licenses/00d402c2bbe7c67369bd01ce2c16b8ed46ccc949a1ee2d6bb8f9606afa8c7434.txt`
- `docs/third-party/licenses/02293bba2170b45a1d8b49b52b695f7bd6f9005ed93f8f047dcededacaf2f9f4.txt`
- `docs/third-party/licenses/03cc9a630489a2544b799548a0e8b134f382fe09fa06dc22b339091b28b8f4a8.txt`
- `docs/third-party/licenses/04575fc5bfae19a9b63100f8691f901a2e15a399011ac02db435a9ef27295551.txt`
- `docs/third-party/licenses/053a75a14b7508a897466b65e12797201a06b0e9b5066d1223da72cac99601b5.txt`
- `docs/third-party/licenses/053fcb19e45c4ed1c275c5f4d25470195c5ca4a71de3f58d97da2b5d6738a260.txt`
- `docs/third-party/licenses/0af366eff4c01ec147c9c61ea9e8ffad64a4294754c9d79355f3fd1b97cb2fb9.txt`
- `docs/third-party/licenses/0e74697a68cebdcd61502c30fe80ab7f9e341d995dcd452023654d57133534b1.txt`
- `docs/third-party/licenses/0f0ca96f50793990031ebc488a38f7292ff70bce8ab6a8e5eeda674abc32ccdf.txt`
- `docs/third-party/licenses/0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e.txt`
- `docs/third-party/licenses/0ffe67fe630169de46df2d29dc18f5857b4c98f0f95b0cd9e3c21fef51f9a9b8.txt`
- `docs/third-party/licenses/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt`
- `docs/third-party/licenses/11d55bd4541c75ee7879547ac49089c489163dae49551389713c3d026cab383e.txt`
- `docs/third-party/licenses/148718606d34f467fd08a2176bb4c1ab275f999576f779368503d8d3e3642861.txt`
- `docs/third-party/licenses/1662fae9b5314d11cf51284e2dcd1f006a354f7343f08712a730fcff9a359801.txt`
- `docs/third-party/licenses/166ffde0aa2773f509ba6edb3d0716602e076eb1cb1b21ae50b8262641af13b3.txt`
- `docs/third-party/licenses/1a3aeb1f1398bd697d57c3c585faadf59d825aca6e3162cd7eeb72ff76eb2466.txt`
- `docs/third-party/licenses/1a9c55b2961f5e3062e181fa55666c44d011fc3cc03ed6d4fa4321c51f2a5ec5.txt`
- `docs/third-party/licenses/1ac0263302bfb8eedc54a10a44175b0df51419306d5bc1539bfd7a7da121bd08.txt`
- `docs/third-party/licenses/1af3c68039c57e539422da82a4faada506ce6d0ea6f90e0b699d02dbcdb7a90c.txt`
- `docs/third-party/licenses/1cbe51b907662f6cb1492b16c359384a595180bf0e4d101603ed525e75c4e484.txt`
- `docs/third-party/licenses/1fa6ee8bb95a81ae3d73a5bd074a3ac380ffec13697051063ca1a601921b91db.txt`
- `docs/third-party/licenses/206c1adcf206dc0031b11232f5b054ec5f1662407ab1ca415247921cab2068ab.txt`
- `docs/third-party/licenses/210549bd75abec340599f291e5ecd95b9acd0d8a713543838ab42f6f462b16bc.txt`
- `docs/third-party/licenses/2130216d5ab4c02134f8247f32999feda0abe1eaf028218baeac445c19ce4cea.txt`
- `docs/third-party/licenses/21c2679a63d7699c0e644409e2f17d0adbc7a965003feb06b3ff4b833d21f722.txt`
- `docs/third-party/licenses/2213d91c606205c71eb051a199478cdc2adde945893404d7f1421436dd6d5cc1.txt`
- `docs/third-party/licenses/22c68811e174cbbfb3813d4135918df4f540959c14d872e601d9abe83d3cde8f.txt`
- `docs/third-party/licenses/22ec6791c91ba42c0516a05f4cbdde019aae4687f8a38c5ca7e8a69ee68f851d.txt`
- `docs/third-party/licenses/23ecfff35a5a2e80d92142f75228912c3b1abc4b5a8337a821ff4397e2f9f734.txt`
- `docs/third-party/licenses/242d37e7cab25cbafc36cc973ee88f9345fddf066afe4f72b7ac3d9ad4e24cce.txt`
- `docs/third-party/licenses/25ba5c59dad3e0dd8f9540beaa0f0a86a10e3aec35af5fdc8e88c5f6a5c0d8c6.txt`
- `docs/third-party/licenses/26c95937762a3dc17a3934a0a2773c70259ba4bf28dab713c225e4af8eb9d349.txt`
- `docs/third-party/licenses/27d06bbb2eb031be8aa376868a2e1f11b6acba938d4cc8e1234b66b9739c54a3.txt`
- `docs/third-party/licenses/29b68325fe026047d13e187b44c33b2acacf7dc647dec4583702e59f235e13b5.txt`
- `docs/third-party/licenses/2a8a5d6197bb97a018b8a190dd3ed853d750ca87c8e80c17aad41d6c6ff448e1.txt`
- `docs/third-party/licenses/2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef.txt`
- `docs/third-party/licenses/2b770a704c15de238c3f622b01b0044ddd60b49ee30608ea6991ebf19db7a7a1.txt`
- `docs/third-party/licenses/2c7c5d22ed5a8ee968c64757710979afcd77438c48b4a265b94e615babd8a901.txt`
- `docs/third-party/licenses/2e97627cb278aa7556fb9e8817368302301a595b6c7582512b8d74c57b773652.txt`
- `docs/third-party/licenses/2eb5c7a0bba9deb77a98c81bf6b9d3fb1c67118eebf968b6b1a787b3f8928ee0.txt`
- `docs/third-party/licenses/306fa513e39b23a6e8747520de761809d206b99800ef41907b530226574c59ae.txt`
- `docs/third-party/licenses/3108b546bcff5d346923a82f48b2d252ca722f9088076db6d145f6b67757ad6c.txt`
- `docs/third-party/licenses/326ff3850062286003ff4cbdaa8f61764e128f9a6532431bccf97e4e2bd75059.txt`
- `docs/third-party/licenses/338b862a4b5959b1583d99ab35801b23375150693c6cc3bf8fcd9156a0e25ddd.txt`
- `docs/third-party/licenses/36571397680e083211d7968a24f46e31cb75df18d4c03fe48896ee1367119fe8.txt`
- `docs/third-party/licenses/36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673.txt`
- `docs/third-party/licenses/3706296ed611888111ceccc1dff4712844dea4bde0b185c82d718c3b69895abe.txt`
- `docs/third-party/licenses/387dd7baa307083401a27c58c362c30832f5ba1dba84f10cc22c33401523f45c.txt`
- `docs/third-party/licenses/39c5ec504cf6bd5cd782a7c695828e09189df79f5d94840e4f08feb97b9fd416.txt`
- `docs/third-party/licenses/3a61c6c96caf5c1d9b623fb9b04c822b783dfcb78aa7e49c76a3f643e6ed7f95.txt`
- `docs/third-party/licenses/3b07ef3fdd96c7f4025deb20139ec92b3fb88d3988b98047d9beee10b659f47b.txt`
- `docs/third-party/licenses/3b6be04f862a077a4b97929dbf247299360824d9365f8603c263769303ace18c.txt`
- `docs/third-party/licenses/3bdddf0b9b08aaa2fe4365b803fc958ed32c0597ca0bd727be8d9fcb8b248d18.txt`
- `docs/third-party/licenses/3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8.txt`
- `docs/third-party/licenses/433fc9dfe659dbfb1e91eed8351f13651e97bfa3ac6d03394c3d63f61d4bbc80.txt`
- `docs/third-party/licenses/435a6722c786b0a56fbe7387028f1d9d3f3a2d0fb615bb8fee118727c3f59b7b.txt`
- `docs/third-party/licenses/45873d00a0dd243596deb4aa23b2493b3d1f0671921bf2538ea431d7380220eb.txt`
- `docs/third-party/licenses/45d196313c2647d313cc65ca9b093d2d6974b64d35ee7346f2c60c9d518dff2c.txt`
- `docs/third-party/licenses/483acb265f182907d1caf6cff9c16c96f31325ed23792832cc5d8b12d5f88c8a.txt`
- `docs/third-party/licenses/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt`
- `docs/third-party/licenses/492328129d2df31681bd85ebc673ebadb6017bcbc7a494e2eaf475eefc0e6d24.txt`
- `docs/third-party/licenses/499507afc8a14166950bd5e445a8206d0b38fab61ea54e436b8bf2fa073cd59a.txt`
- `docs/third-party/licenses/499d6d466d064e0460427967a344e2a32fcb86ea8c6cd1a285ec4f1fa03fba67.txt`
- `docs/third-party/licenses/49d4d143fed599deb502a0fe6e02f49832f87e9a3a4cd0502e469596d50faa6d.txt`
- `docs/third-party/licenses/4be9d87b56a306293223b490c0d0b245e9e94f39884147bf051a6c7b825aeb30.txt`
- `docs/third-party/licenses/4cd903859549d4b20b571041f96dfae1136ed079c476126268f9d7cc1b611150.txt`
- `docs/third-party/licenses/4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b.txt`
- `docs/third-party/licenses/4f8563870d0fca38bbc3e00b6f670cb7fa9f380ba9f26a7f7d1184a6b18b1653.txt`
- `docs/third-party/licenses/52412d7bc7ce4157ea628bbaacb8829e0a9cb3c58f57f99176126bc8cf2bfc85.txt`
- `docs/third-party/licenses/528eec83cb836a0adda9f8fc3d6a2a70a710d6cc0be9a155f92212c8df28acfa.txt`
- `docs/third-party/licenses/52e92576851154bad7737e90cc72818936f43665cb0e3f7428ed8edc8cc5709b.txt`
- `docs/third-party/licenses/53e59feb13058722d977c699eb0407c7bce2f93c949b681bbd2ff31698535927.txt`
- `docs/third-party/licenses/54b081c717705e23ac85e1ecb5fbd174e18d641b2643ccd8d08cdccf4e00f20d.txt`
- `docs/third-party/licenses/5640e5cbe2e9f57f6ccfdd8dbfbeadb875495bdbcb69d2666ce3177ccd0942e4.txt`
- `docs/third-party/licenses/567b1f5e84afcfc97685f3c7fce4c7502e1ac7a91e79cf10980ecd6a9ad38583.txt`
- `docs/third-party/licenses/582024c04f844e8508b52403b29ea437f58aa7948d05ff2684b6a415941d46de.txt`
- `docs/third-party/licenses/5a26e47b9d7020848f061bcad66f8e73cab95f529dab5c02588b21e57c4f876c.txt`
- `docs/third-party/licenses/5b06b483b5c8874fd4e977fedb335067a9e8f722fd45c46ed42797af9d37fbf3.txt`
- `docs/third-party/licenses/5be1f3465bba68a626777f984878814aaf35e7ef8e9fd314d469bcf887050fb8.txt`
- `docs/third-party/licenses/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt`
- `docs/third-party/licenses/5e325595b4ea8cfec3802f545b1def5d7b73e4a5b8e9ba63e32a320f67732292.txt`
- `docs/third-party/licenses/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt`
- `docs/third-party/licenses/653b779005a3a4d64a7288c940f7b9a0e8f0b1e0375f6aa6af9473caf131e564.txt`
- `docs/third-party/licenses/6582629e2979466878f6014313dcc2f3756c9616148682227ce3063dde310750.txt`
- `docs/third-party/licenses/68f12f6e2c33688699249c01d8f9623c534da20aa71989c57b061b7bc1676d14.txt`
- `docs/third-party/licenses/693866fc419c6f61c8570438ec00659d156ec2b4d4a4d04091711f5f11a365d4.txt`
- `docs/third-party/licenses/69dee148a2cc470554dfa7142e830662062394d0fe67cddd379aba90dc60d6b3.txt`
- `docs/third-party/licenses/6a134e51aa31496c15a741592fc5d782b2dbf8d8b6b8524e15c8520ae0cd6374.txt`
- `docs/third-party/licenses/6cb0631f71c7749763fd3dd1d5bee52dd1070ec17f2edc1710079ad070bd2fbd.txt`
- `docs/third-party/licenses/6d0917530cf3b3dca12c1ab7798e4d38ad0a6798ecc1bd27849a3048ba91d265.txt`
- `docs/third-party/licenses/6d602191187b35b9b01d2cffa01c8469c2c8d9de8a96f1bf868e0f264f51c81d.txt`
- `docs/third-party/licenses/6ee0feb1f6ef996ff5a68600f8cf98909cf412d39ef3cdceaefd87d636fa1b7f.txt`
- `docs/third-party/licenses/71368fd0f5b4129191e9afcd1e1ef2dc89a9090d3e4d80bbab92dafd032b3bef.txt`
- `docs/third-party/licenses/715f1f0f2eb7688e53e4e958acdc7fc9e365ae3eaf26efc2604b93cc65fdc3f5.txt`
- `docs/third-party/licenses/719a251ceca49c057ea90a1152af6546b767ec88e6d573bb6324454267b32c22.txt`
- `docs/third-party/licenses/73b5283588baa142c5baaef5f56d3e8fdea7a30b214e8c5737e87640f882453a.txt`
- `docs/third-party/licenses/768faff9f6908c78d848b18770b2a93e3361d6e2ee35edf45c6a5ddf1f7cb185.txt`
- `docs/third-party/licenses/769d154fbde32a915af110b1123650bc79f4cbe675acc66e005265bf069c6c6c.txt`
- `docs/third-party/licenses/76a876cf886ff9be2a8b5e2e86514fed06223c8c9f0c1e9ee9606e93841e00b7.txt`
- `docs/third-party/licenses/76c9d5f5ea942054715c026f33f8717c9e24603196a3737b8899afa216bcbdab.txt`
- `docs/third-party/licenses/773e131a7684726005a7e4688a80b4620033bc08499bc1404dd1a1eb3bca725e.txt`
- `docs/third-party/licenses/7771f0b6f55e76efe99cb8e6fdbff583193c9bdfd74d41620d330cc3db6b913a.txt`
- `docs/third-party/licenses/77c9ee6a9c5d5782fb0c50b50d101189116314c14f7df0a1b0d385fc96a7ba49.txt`
- `docs/third-party/licenses/7917b04272f3f7c11f9fb89716742747a77f5906ebe5a81e70cbd090b8c7f961.txt`
- `docs/third-party/licenses/7bf9b2de73a6b356761c948d0e9eeb4be6c1270bd04c79cd489c1e400ffdfc1a.txt`
- `docs/third-party/licenses/7c52c9115673b3e47e2a78c9c911558b7b2f23b144a3927e5fa862e1409727ba.txt`
- `docs/third-party/licenses/7c6cc83c84eaa249a85bf12fe3eedd831bb50c696e8890b5248223ae68c7b408.txt`
- `docs/third-party/licenses/7cdf9db3b91cc77b9ec947ad0c7126140f00e34528b67c3a58e9fc1a98055e14.txt`
- `docs/third-party/licenses/82b19019e25e266a310ef46800b3af726136a3cee79af8812dc83ca0b045afae.txt`
- `docs/third-party/licenses/881d660c26831481b697e39724d4a35c9f86e07b67156d4aeb693a0b39910435.txt`
- `docs/third-party/licenses/8a1af140fdfbf5afd3df27f7e662f989c5b963a300020dfafce42033cae9e004.txt`
- `docs/third-party/licenses/8a4b6c44eebfb026d23719a348145a661a555568dbfdc11618ff2d0dd9306b00.txt`
- `docs/third-party/licenses/8a6dcbabe7179f9c8489c08a7d874d0f1e093ae7449e03756ccf87cb9d0e296e.txt`
- `docs/third-party/licenses/8bcfa73a7b42b5c786a8a05291f9a5573a8d5f2446a956203c2e4c0e755d73b7.txt`
- `docs/third-party/licenses/8c535800331e1e4439835555b3f9edc7fe9dee2fab0d8bbbd5a982e8b8343d4d.txt`
- `docs/third-party/licenses/8d8c55319c7729d57be811c747452636688d54f19701ee0752b6b15ad3771d9a.txt`
- `docs/third-party/licenses/942a98cb8846a6354266193f173c1354615827fbb7d67f68399599dff12c4d6a.txt`
- `docs/third-party/licenses/947e32047a166cd05f04e45938d172b412c07cbee0b9735afd14bae30e02c2f6.txt`
- `docs/third-party/licenses/95ced5ecf1133fbf41d409b5555c86c344f83f3b019926057ddbc07cfdcc27b3.txt`
- `docs/third-party/licenses/9616325393b574ca774a0409b95b05cb0f640393513f72da00c5e3191de4a1ea.txt`
- `docs/third-party/licenses/9638fa87f845af6cecc56fab498c1f74f4a98522d3b53377bedcbdb44b5a8dcc.txt`
- `docs/third-party/licenses/9680978280d509520d2a7b51e93ffbf7d9ec2b9de4411a6989daba5b659048e0.txt`
- `docs/third-party/licenses/971e376febf7afbcceab6857e243f2ccb3ea88f520b68c324af15a28171f5de3.txt`
- `docs/third-party/licenses/9877e90da14aa8c931a1f9d07cc2a20ce119106e5dab1ebb41af865266d0cd2a.txt`
- `docs/third-party/licenses/98d226d560dfbb0a07a77c3654acc18ba6c87589c48cf00cb2a9855ad50fcd07.txt`
- `docs/third-party/licenses/9a39f2aadab11a3697edd668ff2d8ad885b649737b7ab4d3bf12b34e5ada0c86.txt`
- `docs/third-party/licenses/9a9edad7baae52622bddf3c15b2ef8a33d2c89f2d25408ad13e8a7481c6b0c97.txt`
- `docs/third-party/licenses/9b0ffd74f2cde7528141cc314ece705490d11054805da4a01ee6149498951b8f.txt`
- `docs/third-party/licenses/9c63a23124d68cd30cd316a94a1a0bca34f032786df6df69fc4b5f136bac8d2e.txt`
- `docs/third-party/licenses/9c94db23dc4b1e9aaee5d195668b916afc71efed54af226b66cf0ccc4389c1c0.txt`
- `docs/third-party/licenses/9ea1eccdabe469767a9edb9249a840b2461cf91b2434bf8a3e2fc1f414311cb1.txt`
- `docs/third-party/licenses/a07bc24468b9654ce76a547d47a2db282d07733b715db4c73a98bd63961f9550.txt`
- `docs/third-party/licenses/a0e2f73971f663b49d3c66cc6749fc88de0f475680ccf5b980a9cbcc0c52490f.txt`
- `docs/third-party/licenses/a1bd5deadb6a06dd74efa852c1b8b23f63b67f2214fbe9c8bd591da51da69268.txt`
- `docs/third-party/licenses/a405ee70c632bb938acb7ac5f210e814409b3760ea9d2329d8ed8ffcfd11a0e7.txt`
- `docs/third-party/licenses/a549d329bad8806fe279f0ecae0fc0270dec7e7c2dc8ec10f90e394f7c32b144.txt`
- `docs/third-party/licenses/a596744eec6b05682ed972bf93937668bbc8da2caed93fbf6510389de019b5c0.txt`
- `docs/third-party/licenses/a5e49293b629194f16e08c965807b34a4a8f45aa2735658a3b0e3c1478a34b30.txt`
- `docs/third-party/licenses/a6a23fb76d91d98669f5ed6eb58213df594ab2d56c9e981ae021b194e3d662a7.txt`
- `docs/third-party/licenses/a6c1514885935d6b699b7e6c1ab22e9312189a75a4e937d83f20749a67d0dbe7.txt`
- `docs/third-party/licenses/a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9.txt`
- `docs/third-party/licenses/a6db8096b2707bc0102d256917d4d33f298ba36d8c3f25de067a2b5bb379db27.txt`
- `docs/third-party/licenses/a6f36438e46fb911859f3b9c4cad045ba64e1af3d8f4512c60258fa2d7552d28.txt`
- `docs/third-party/licenses/a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47.txt`
- `docs/third-party/licenses/a833d366242c298cf1b10263516572fb8dcbe68eb5072cdcac2b4546e2b4eb36.txt`
- `docs/third-party/licenses/a877291d800ed43692f3f9ae09d8e01cc6f7293ad39d43896059c188ffbb8b7c.txt`
- `docs/third-party/licenses/a889cc4dbee2ae172c179856b25d75b0b7a5a136e1b97109b9b590b2ff1a879c.txt`
- `docs/third-party/licenses/aaa78451b6fecd1b9c4594c796c133c0e90cad100372ff8bc6de615e9ef9adf1.txt`
- `docs/third-party/licenses/ab654de803cdaa9e2819ab2e934bdf7f757e308649ec231d78e80e92425cdc34.txt`
- `docs/third-party/licenses/ac68116ae73740de4190892f334992e449a124600924ec761e64319d3aac9e6e.txt`
- `docs/third-party/licenses/acfaf437865d82f0fa9b9cdcae8b550bed8d011adaa5b42d973191caf99f62a8.txt`
- `docs/third-party/licenses/af175b9d96ee93c21a036152e1b905b0b95304d4ae8c2c921c7609100ba8df7e.txt`
- `docs/third-party/licenses/b154c4cabeeb587f5cc63a41d0551ae69504460762d189a72ae141558ec5d184.txt`
- `docs/third-party/licenses/b17ac0bd6f4b8207e440639cc8e0ba1bf1d9eaf9b12236764ab93b346c7abd8e.txt`
- `docs/third-party/licenses/b181da80336ff9dd1043fc8be1a764d7382363433319aa872e4d2cb5ce2a3066.txt`
- `docs/third-party/licenses/b1a41a2bed2722f10267002c9cc5d3675622962ad8487c4de28ee720ac92bd2e.txt`
- `docs/third-party/licenses/b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1.txt`
- `docs/third-party/licenses/b41d08bc3624d8c436fc80237d73ebb361985a67f4504bbcd703e5ca2b27254c.txt`
- `docs/third-party/licenses/b505862c2bf0b38f98a4629efe0d17fb87690cbd35a9f3ae95d2fd769d7cea23.txt`
- `docs/third-party/licenses/b5a4028c49c48f820831421de69c8ea83d621a062914bf16739fd0703c7c9fba.txt`
- `docs/third-party/licenses/b8778b155bfde5a28b023a558753c0fa058a52bb9de35c343c250be1bbcdedab.txt`
- `docs/third-party/licenses/b9eb082c39fe245e38793699074c394c43a722c51fce031c3c165cb92a31035c.txt`
- `docs/third-party/licenses/bd40cc437e28a3ad7bef2ad34e6b72e757b182e67bda1acadbab4ef0476f8232.txt`
- `docs/third-party/licenses/bd4539377980dd797fc6a51d90e664e52b2b2625b2158f01d4c68b5fe107eacb.txt`
- `docs/third-party/licenses/be46ce1e3b0479af9ce82d22b465a6d7d2ff084fca0aaf3d54172da2b5eb5781.txt`
- `docs/third-party/licenses/bf8fd38056b7606deccfcadb4d8ca1c210082d8ef5513426d2650daedc30bed3.txt`
- `docs/third-party/licenses/bf9b0d665be2a689851eea667ca9f42066ea1d903b38349c51e6a44b2577680a.txt`
- `docs/third-party/licenses/bfc4406bbf7f0bc110196312ce26471bcc7c47666949ef6a42fa500cfcb4173a.txt`
- `docs/third-party/licenses/c02110eedc16c7114f1a9bdc026c65626ce1d9c7e27fd51a8e0feee8a48a6858.txt`
- `docs/third-party/licenses/c064f7a3e353bc1bc977f3c897941c75ef763f44f41677e0a15370ca0853d6e2.txt`
- `docs/third-party/licenses/c16d06f1808d8d8c6ec0f6b6fb7e951126c46730fbb67320863a81f8aa8ca033.txt`
- `docs/third-party/licenses/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt`
- `docs/third-party/licenses/c5c6c5183a789d122f267c405f685037efb87e27fcde28ab1dd7378a2d2f5962.txt`
- `docs/third-party/licenses/c61652db3d2808f667b48af0a358f0d85fd07ad4a0d0b1a50882dec3b764c522.txt`
- `docs/third-party/licenses/c64182d48160db948b6aa97a984f1a32974ce4d2053900361264cd33853796cb.txt`
- `docs/third-party/licenses/c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4.txt`
- `docs/third-party/licenses/c8df456c7ccba74b959087dff494d4ac2a12dfb0400c08b46b2494a08a000567.txt`
- `docs/third-party/licenses/cb1764d4708e870cc694de13d499af2e6ee98d2751026e3a3f79de608f4f4ea0.txt`
- `docs/third-party/licenses/cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164.txt`
- `docs/third-party/licenses/cebc084d54e6dd99e53292ddb4bc1cdb63d9bfcd9ce438fe3aa6eb106d79e2ea.txt`
- `docs/third-party/licenses/cfa72b62b9ae173078823a3796b25c027a9071046a263beddf966df67018ce06.txt`
- `docs/third-party/licenses/cfc3f455254c0af0655cc3ff46a41ed644b67599f6043346169d285bf2b3cf3b.txt`
- `docs/third-party/licenses/d00d032f517721b45c56c70c46bf904ebb71ad313df4d4db7722266b38069665.txt`
- `docs/third-party/licenses/d07913d776eef217a95d7ee3ee83577fc3c365b9c870f5a3411f785b81090614.txt`
- `docs/third-party/licenses/d0cd141b0c322fded5dfad1d4645bb2fedfc05b7321fe1009469638190d59ef9.txt`
- `docs/third-party/licenses/d2b58ab7545711127fbbda1c5b518822d03ae782a4a64a5f49104893e893d6ca.txt`
- `docs/third-party/licenses/d3a724e2ed749f172ff70b62a1d0631b7d4b0ea273782365a3464d4e2d6b6dbd.txt`
- `docs/third-party/licenses/d408f38ffa3355c5faec517153295338892eb0f1ea43f57874bb23c6075979b5.txt`
- `docs/third-party/licenses/d6151cc698dc6a772e5b448069270a095488f3962aef0b11e78974e1e1587082.txt`
- `docs/third-party/licenses/d8bf34ff6d190640a01e7704ad78253fc181bc128949d71273fbbaa12f33c0b4.txt`
- `docs/third-party/licenses/d90bf0a089da4cf43d644ed240a0b3825dcdb705e64e38371d56995a4cc9e4c5.txt`
- `docs/third-party/licenses/da4db1480d9beea3483a2eda5c53b22238d0827d57da162b48f122e04d2d9987.txt`
- `docs/third-party/licenses/da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93.txt`
- `docs/third-party/licenses/db480f236292a093e77a83c35431a8496624e1e664a3547768a9ce2bdde39877.txt`
- `docs/third-party/licenses/dbffd380d59504ba19fcf87ff5a1a33c37edf66d5b09966b0ad5368ab87bc2af.txt`
- `docs/third-party/licenses/dc0fe5a22d9336f345ee984f9bf56f11f22877a3aa5fd16a1db9a8ca0e23a5d1.txt`
- `docs/third-party/licenses/de4d1f2d2ad5ad0cfd1657a106476b31cb5db5ef9d1ff842b237c0c81f0c8a23.txt`
- `docs/third-party/licenses/e09f9b52c6ce5c17ba8103cd0cbf446c33b5448b0c1d01d711b36a1f15a501ba.txt`
- `docs/third-party/licenses/e1919b3b98b8bf6c1b99fcc60a0ed46027c97ac947432e1278446c9606f50161.txt`
- `docs/third-party/licenses/e2560e002e13281578c75c850061d9255c33d16d732939e8c2db64c2506642fa.txt`
- `docs/third-party/licenses/e3a956681ee067f971ac413994171b3d90ca801ec6324e76c9c55366cfe31cb0.txt`
- `docs/third-party/licenses/e539937c489c4928ad7461669ec017f4d916fb3565fc26f5b8a0ce816d2ed23c.txt`
- `docs/third-party/licenses/e85e131fa4ed25538ff1f4962ced1fb6f68b079bd9164a790597a0f30b8fd030.txt`
- `docs/third-party/licenses/eab1e270ad6ecc6fdd64f9c149e019633fb6e59b2445002cb33d14f93092c42f.txt`
- `docs/third-party/licenses/ee48679d379ca6b4493d5e231094d85f818dd9be40b1a4f234fb7ff657ee35d9.txt`
- `docs/third-party/licenses/f2042f3634c4136d06b5139c9c6aefb81a3a462b514548bc1845953233dfba98.txt`
- `docs/third-party/licenses/f3c51ace7f159b21566d72535e84ff354505ae7ffdca835dac81fcdafbf9e879.txt`
- `docs/third-party/licenses/f71e8ed126b46346494aad5486874cd8f0aafe95092ed67d2e3cb6110f939abc.txt`
- `docs/third-party/licenses/f95f668fe64081ddb4153b322e34fdd719b991285ed08177d5ad7133b7988d92.txt`
- `docs/third-party/licenses/fba570176c68f716676e04cad6c39fb56b763e44fc11be22fe6863ff19092a9b.txt`
- `docs/third-party/licenses/fc68eb8f1c8e1d6b8be50f3c177927e24791cae7dc251e6253a012f37926a30c.txt`
- `docs/third-party/licenses/fcf6eabf68ca96988a6b506b4fdc6cc32535d80eb2e11c79724af5ac6f50262b.txt`
- `docs/third-party/licenses/fd3a263fe19ed8faa9068b43abaebafc02c77897b0c6fc09abc04bb592e5f16e.txt`

## 1550b21add693d0518b59a1aa564c0616167eab9

docs: describe Taskora architecture and verified remediation

Files:

- `README.md`

## a956a03014b7965f3429349e5fbd728fd86144bc

fix: validate issue hierarchies without recursive graph walks

Files:

- `src/data/issue-hierarchy-integrity.test.ts`
- `src/data/snapshot-validation.ts`
- `src/domain/invariants.ts`

## f7b31101c96cd587950b110f7de0e0c887188622

test: remove redundant hierarchy fixture guard

Files:

- `src/data/issue-hierarchy-integrity.test.ts`

## 50b30b91e0335cdc3f9f3f924236e01a1270756b

feat: manage issue relationships with atomic revision checks

Files:

- `src/data/gateway/contracts.ts`
- `src/data/gateway/issue-relationships.test.ts`
- `src/data/gateway/mock-gateway.ts`
- `src/data/gateway/tracing.ts`

## 2c11d656553a77855ec1767765aed6f099e342d9

feat: edit issue dependencies and hierarchy from issue details

Files:

- `e2e/issue-relationships.spec.ts`
- `src/app/pages/IssueDetailPage.tsx`
- `src/app/query/keys.ts`
- `src/features/issues/IssueRelationshipsPanel.test.tsx`
- `src/features/issues/IssueRelationshipsPanel.tsx`
- `src/features/issues/issue-relationship-queries.ts`
- `src/features/issues/issue-relationships.css`

## Verification boundary

The initial five commits preserve the reviewed remediation tree. That combined tree passed 355 tests, lint/types, a current dependency audit and inventory hash validation before commit organization. Earlier complete build/coverage/E2E receipts remain available outside Git. The hierarchy commit a956a03 contains a redundant-guard lint error and its verification note is inaccurate; f7b3110 corrects it, with 40 targeted tests, lint and types passing. It was not amended or hidden.

The gateway increment passed 79 targeted tests, types and lint. The UI increment passed 24 targeted rendered tests and final full checks: 380 coverage tests, 25 Chromium journeys, lint, types, build, audit. No failing source is knowingly left in the final tree. See TASKORA_DOMAIN_AND_DATA_TEST_REPORT.md for failed attempts and fixes.

The subsequent documentation commit contains the eight TASKORA_*.md reports and README links. Its final hash and complete file list are recorded in the external final-commit-manifest.md to avoid a self-referential commit hash. Private reports, credentials, raw logs and submission packages are not included.
