# Compatibility

What has actually been exercised, as of 2026-09-30. "Emulated" means a desktop Chromium browser set to a tablet or phone size with synthetic pointer events: it checks layout and logic, **not** pen pressure, palm rejection, latency, gestures or on-screen keyboards.

| Environment | Status | Notes |
| --- | --- | --- |
| Desktop Chromium (Chrome/Edge), mouse | Used throughout development | All features; the in-app browser used for checks is Chromium-based. |
| Desktop Firefox | Not tested | Expected to work; the delegated ink trail (Ink API) is Chromium-only, and ink falls back to predicted samples. |
| Desktop Safari | Not tested | |
| iPad + Apple Pencil, Safari | Not tested | Emulated layout at 768 × 1024 only. Needs HTTPS (see [self-hosting](self-hosting.md)). |
| Android tablet + stylus, Chrome | Not tested | Emulated layout only. |
| Phone | Emulated layout at 375 × 812 | Usable for reading and quizzes; not a target for writing. |
| Offline (installed shell, no network) | Tested in desktop Chromium | Saved notes reopen and can be edited; AI actions need the network and an explicit retry. |
| DeepSeek `deepseek-flash`, JSON output mode | Live-tested | 57 recorded prompts; see `docs/experiments/prompt-eval/`. |
| DeepSeek image input (reading handwriting) | Not built | |

Device reports are very welcome; the bug template asks for the exact device, browser and pen.
