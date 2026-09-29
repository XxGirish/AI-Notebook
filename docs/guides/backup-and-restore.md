# Backup, restore and moving between devices

## Where notebooks live

In the browser that opened the app, in IndexedDB, for that one site address. That storage is **not a backup**:

- another browser, another browser profile, or the same app at a different address (for example `localhost` versus your LAN name) sees a different, empty notebook;
- clearing site data, some private-browsing modes, and storage pressure on a full device can delete it;
- there is no automatic sync between devices.

The notebook menu (the **⋯** button beside the page title) shows how much storage the notebook uses. If the browser refuses a write (for example because storage is full), the status says so and the change is **not** marked "Saved".

## Archiving one page or backing up everything

The notebook menu has two archive actions, both available once everything is saved:

- **Archive page** downloads only the page you have open, named after it (for example `forces-and-motion.ainotebook`). It carries that page's objects, images, quiz answers, AI reports and AI provenance. It does **not** include uploaded sources or the chat history, which belong to the whole notebook.
- **Back up all** downloads the whole notebook as `ai-notebook-<date>.ainotebook`. Use it for backups and for moving to another device.

A whole-notebook backup contains:

- every page with its objects, paper choice and AI provenance;
- every image, stored once by content hash;
- uploaded sources, as their extracted text and passages (the original PDF/Word files are not kept);
- the study-assistant chat history;
- quiz answers, with question versions and hint/reveal use;
- your reports on AI content;
- a manifest with a SHA-256 hash of every file inside.

It never contains your DeepSeek key, the gateway token, or gateway logs. Device preferences, such as the canvas pattern and touch mode, stay on the device and are not included.

Keep archives somewhere that is backed up, such as a cloud drive. An archive is a ZIP file; its contents are readable JSON.

## Restoring or moving to another device

Open the app on the other device (over HTTPS for a tablet — see [self-hosting](self-hosting.md)), then open the notebook menu (**⋯**) → **Import archive…** and choose the archive.

Import always adds an **independent copy**: pages get new identities and are added after the existing ones, so importing never overwrites anything. A source whose file is already on the device is not stored twice. Before anything is written, the whole archive is checked: its format version, every hash, sizes, unknown fields, references between objects, and missing or unexpected files. A damaged or tampered archive is refused with a reason and changes nothing.

Because imports are copies, editing the same notebook on two devices and importing back and forth produces duplicates rather than merged changes. There is no merge.

## Undoing a recent mistake

- **Undo / Redo** (Ctrl+Z / Ctrl+Y) cover everything done on the page since it was opened, including AI insertions.
- **Restore previous version** in the notebook menu swaps the page with its previous saved version. Pressing it again swaps back.
- Deleting a page asks for confirmation and cannot be undone, except by importing an archive that contains it.

## Older archives

Archives made by earlier versions still import: version-1 archives (pages, images and AI provenance only) and pages from every earlier document schema are migrated on the way in. An archive made by a *newer* version than the app is refused rather than partly imported.
