# SillyTavern personal snapshot — 2026-11-05

This private snapshot preserves the locally installed SillyTavern 1.18.0 and current user data. It does not upgrade the application. `data/default-user/` includes characters, chats, world books, presets, and settings.

All 10 user extensions are included as ordinary files, without nested Git repositories. They can be restored by cloning this branch without submodule setup. Their built files are included; extension repositories' development dependencies are excluded.

API keys/password fields and known credential strings have been scrubbed from this copy, including extension settings and character metadata where present. `secrets.json`, account storage, cookie secrets, logs, thumbnails, caches, and rolling backups are omitted. Re-enter API keys after restoration; browser local storage is not included. Original local files are unchanged. Old commits in this repository still contain the previous settings and must not be treated as scrubbed; rotate real credentials previously stored there.

The copied config retains the original listen port 7893 and whitelist settings. Authentication is disabled in that original config; configure authentication and HTTPS before exposing it. Do not publish this repository or this personal data.

For Linux, install a supported Node.js LTS version satisfying Node >=20, run `npm ci --omit=dev`, and use systemd or a container for process management. Keep application data on persistent storage and back it up separately. Do not copy Windows node_modules. The Windows Start.bat is the committed original, without the local TLS-verification bypass.

The accompanying SNAPSHOT-MANIFEST.json records SHA-256 hashes, extension revisions, and redaction counts. Verification covers file integrity and credential checks, not a live server deployment or complete runtime compatibility.
