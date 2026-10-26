# Optional BARkey / KeyboardKit Pro backend

The default is vendored Hex: the vault had no `KEYBOARDKIT_LICENSE_KEY` on October 12.
`project-keyboardkit.yml` is the optional XcodeGen spec; it reuses the same Finish/Rephrase/Expand
controller and BARkey's AppleAutocompleteService. The license is fetched at runtime from the
Tailscale Mini and never embedded in the bundle. The optional backend is not runtime-validated
without a Pro license. It only sees the iOS proxy window, so select all for long existing drafts.

After purchasing Pro, place the key in `~/.secrets/telegraph.env`. The device script can select
the optional spec with `USUAL_KEYBOARD_BASE=keyboardkit`; it refuses if the vault key is absent.
The default stays Hex until the licensed backend passes the same typing, draft replacement,
Finish, Undo, Rephrase and Expand checks on PJ iPhone. Licensing activation is not part of the
Haiku/Jev test-spend authorization. No KeyboardKit account or license was purchased here.

Build 6's swipe trial is integrated with Hex's touch surface. A future switch to this optional
backend must port and verify swipe capture too; this adapter does not currently provide swipe.
