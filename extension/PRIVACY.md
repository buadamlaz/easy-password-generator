# Privacy Policy — Easy Password Generator

_Last updated: 2026-10-12_

Easy Password Generator is designed to be **privacy-first**. This policy
explains, plainly, what the extension does and does not do with your data.

## Summary

- The extension does **not** collect, store, transmit, or share any personal
  data or passwords.
- All password generation happens **locally in your browser**.
- The only thing saved is your **generator preferences** (password length and
  which character types you selected).

## What is stored

Using `chrome.storage.local`, the extension stores a single preferences object:

- Password length
- Uppercase enabled/disabled
- Lowercase enabled/disabled
- Numbers enabled/disabled
- Special characters enabled/disabled
- Exclude ambiguous characters enabled/disabled

This data stays on your device. It is never uploaded or synchronized.

## What is NOT stored or collected

- Generated passwords (never stored, logged, or kept in history).
- Any values you have typed into web pages (credentials, form data, etc.).
- Browsing history, URLs, or page content.
- Any personally identifiable information.

## Network use

The extension makes **no network requests**. It contains no analytics,
telemetry, advertising, trackers, external APIs, or remotely loaded code.

## Permissions

- `contextMenus` — to add the "Generate Password" right-click menu item.
- `storage` — to remember your generator preferences (listed above) only.
- `clipboardWrite` — to copy a generated password when you click "Copy".
- Content script access to pages — so the generator can appear on input fields.

Each permission is used solely for the stated purpose.

## Changes

Any future changes to this policy will be reflected in this file within the
published extension.

## Contact

For questions about this policy or the extension:

- Website: https://www.sezgin.net.tr
- GitHub: https://github.com/buadamlaz
