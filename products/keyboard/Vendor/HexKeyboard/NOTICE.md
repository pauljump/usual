Vendored from https://github.com/AVGVSTVS96/hex-keyboard at the revision in UPSTREAM.
MIT license retained in LICENSE; dictionary licenses in Sources/KeyboardUI/Resources/LEXICON-LICENSE.
Usual changes: app group, an accessory row above the existing suggestion bar, personal vocabulary seeding,
and a replay executable. Usual also protects visible key faces from prediction reassignment and
keeps the initial tap position through incidental movement under 8 points; deliberate slides remain.
No upstream app, service, account, or distribution integration is used.

Offline swipe decoding is adapted from nkrsn/jboard at
70b9d5af92ca4a6846db8bae18834c4cb1e2c510 (Core/SwipeDecoder.swift).
The original MIT copyright and license are retained in JBOARD-LICENSE.
Usual adaptations keep the core free of framework imports, reuse Hex's dictionary and
personal vocabulary, and limit expensive path matching to 24 finalists. Optional compiled
spellings/segment reuse remain available for replay but did not help the final framework-free
implementation enough to enable on the phone. Touch capture, ordering, document guards, word insertion,
alternatives and deletion are integrated with the existing Hex/Usual controller.
