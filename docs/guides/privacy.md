# Privacy and data flow

AI Notebook has no accounts and no server-side notebook storage. This page lists everything that can leave the device, and when.

## Nothing leaves without an explicit action

Writing, drawing, typing, editing, saving, undo, export and import, answering quizzes (including hints and grading) and searching uploaded sources all run in the browser with no network requests. The service worker caches the app itself.

Handwriting is never sent anywhere. Pen Pro neatens it on the device.

## What an AI action sends

When you press **Teach a section**, **Explain selection**, **Create diagram** or **Create quiz**, the browser sends the gateway:

- the text of the selected notes, cards, equations (as LaTeX), converted handwriting text and diagram labels, plus a bounded amount of nearby text for context, trimmed to 64 KiB;
- quiz prompts and option labels, but **never** a quiz's answer key or rationale;
- the page's ID and the IDs and revisions of what was sent, so the answer can be checked against the page later.

It does not send ink strokes, images, other pages, or anything beyond that bound.

## What a study-assistant question sends

The question, recent turns of the conversation, and up to a small number of passages that keyword search found in your uploaded files and (if enabled) your notebook pages. The panel names how many passages and sources a question will use, and uploaded files can be excluded individually. Files are read on the device and only their text is kept.

## What the gateway does with it

The gateway is a program you run yourself. It forwards the request to DeepSeek with your API key, validates the answer, and returns it. Its logs contain request IDs, the action, model, timing, outcome and token counts, never the notes, passages, answers or key. Its limits (one request at a time, per-minute and daily caps) are held in memory.

With `AI_PROVIDER=mock` (the default) nothing is sent to DeepSeek at all.

## DeepSeek

Everything the gateway forwards is processed by DeepSeek under the terms of **your** DeepSeek account. This project does not claim DeepSeek retains nothing or does not use API data for training; check DeepSeek's current terms before sending anything sensitive.

## What stays on the device

Notebooks, images, uploaded sources, chat history, quiz answers and AI problem reports are stored in the browser's IndexedDB. Reports on AI content are **not** sent anywhere; they are there for you and travel only inside archives you export.
