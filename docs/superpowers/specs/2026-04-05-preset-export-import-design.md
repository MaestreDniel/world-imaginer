# Preset Export / Import — Design Spec

**Date:** 2026-04-05  
**Project:** 07-advanced-terrain  
**Status:** Approved

---

## Problem

User-created presets are stored in `localStorage`, which is browser- and machine-local. There is no way to share a preset with another person or move it to a different machine.

---

## Goal

Allow exporting and importing individual presets (built-in and user-created) as JSON files.

---

## Scope

- Per-preset export and import (one at a time).
- All presets are exportable — built-in and user-saved alike.
- On import, name conflicts are resolved by auto-renaming (e.g. "Flat Plains (2)").
- All changes confined to `07-advanced-terrain/src/debugPanel.ts`.

---

## File Format

Each exported file is a `.json` file named after the preset (e.g. `Extreme Mountains.json`):

```json
{
  "worldImaginerPreset": true,
  "name": "Extreme Mountains",
  "params": { ... }
}
```

- `worldImaginerPreset: true` — sentinel for quick validation on import; any file missing this field is rejected with an `alert`.
- `name` — the preset name at export time.
- `params` — a full `GenerationParams` object (same shape as stored in localStorage).

---

## UI Changes

The existing preset row in `buildPresetRow()` gains two buttons appended after **Del**:

| Button | Label | Action |
|--------|-------|--------|
| Export | `↓` | Downloads the selected preset as `<name>.json` |
| Import | `↑` | Opens a file picker; reads, validates, renames if needed, saves as user preset, selects it |

Button styling matches the existing Save/Del buttons (`background:#0f3460`, same padding/border).

---

## Behaviour Details

### Export

1. Read current slider values into `this.params` (`readSlidersIntoParams()`).
2. Get the selected preset from `this.presets` by name.
3. Serialize to JSON with the sentinel + name + params.
4. Create a `Blob` (`application/json`), generate an object URL, click a temporary `<a download="...">`, then revoke the URL.

### Import

1. Create a hidden `<input type="file" accept=".json">`, click it.
2. On `change`, read the file as text via `FileReader`.
3. Parse JSON; if `worldImaginerPreset !== true`, `alert("Not a valid preset file.")` and abort.
4. Resolve name conflict: while a preset with the candidate name exists, append ` (N)` incrementing N from 2.
5. Push the new preset (with `builtIn: false`) onto `this.presets`.
6. Call `saveUserPresets(this.presets)` to persist to localStorage.
7. Call `refreshPresetOptions()` and set `this.presetSelect.value` to the new name.

---

## Conflict Resolution

Auto-rename on import — no user prompt:

- "Flat Plains" exists → imported becomes "Flat Plains (2)"
- "Flat Plains (2)" also exists → becomes "Flat Plains (3)"
- etc.

This applies even when the conflicting preset is a built-in.

---

## What Is Not Changing

- `generationParams.ts` — no changes.
- `main.ts` — no changes.
- localStorage key or schema — no changes.
- Bulk export/import — out of scope.
