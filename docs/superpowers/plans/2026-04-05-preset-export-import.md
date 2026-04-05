# Preset Export / Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Export (↓) and Import (↑) buttons to the preset row in the debug panel, enabling per-preset JSON file download and upload.

**Architecture:** All changes are in a single file (`debugPanel.ts`). Export serializes the selected preset to a JSON blob and triggers a browser download. Import opens a file picker, validates the JSON sentinel, resolves name conflicts by auto-incrementing, and saves the result as a user preset via the existing `saveUserPresets` path.

**Tech Stack:** TypeScript, browser APIs (`Blob`, `URL.createObjectURL`, `FileReader`, `<input type="file">`), existing Vite+TS project setup.

---

### Task 1: Add `exportPreset()` method and Export button

**Files:**
- Modify: `07-advanced-terrain/src/debugPanel.ts`

- [ ] **Step 1: Add the `exportPreset()` private method**

  In `debugPanel.ts`, add this method after `deletePreset()` (around line 526):

  ```typescript
  private exportPreset(): void {
    const name = this.presetSelect.value;
    const preset = this.presets.find(p => p.name === name);
    if (!preset) return;
    const data = JSON.stringify(
      { worldImaginerPreset: true, name: preset.name, params: preset.params },
      null,
      2,
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preset.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  ```

- [ ] **Step 2: Add the Export button in `buildPresetRow()`**

  In `buildPresetRow()`, after the `delBtn` block (around line 295), add:

  ```typescript
  const exportBtn = document.createElement("span");
  exportBtn.textContent = "↓";
  exportBtn.title = "Export preset";
  exportBtn.style.cssText = "background:#0f3460;padding:3px 6px;border-radius:3px;border:1px solid #555;cursor:pointer;font-size:0.65rem;";
  exportBtn.addEventListener("click", () => this.exportPreset());

  row.appendChild(this.presetSelect);
  row.appendChild(saveBtn);
  row.appendChild(delBtn);
  row.appendChild(exportBtn);
  ```

  Note: the existing `return row;` stays at the end of `buildPresetRow()`.

- [ ] **Step 3: Verify manually**

  Run `npm run dev` from `07-advanced-terrain/`. Open the panel, select any preset, click ↓. A `.json` file should download named after the preset. Open it and confirm it contains `worldImaginerPreset`, `name`, and `params`.

- [ ] **Step 4: Commit**

  ```bash
  git add 07-advanced-terrain/src/debugPanel.ts
  git commit -m "feat: add preset export button (JSON file download)"
  ```

---

### Task 2: Add `importPreset()` method and Import button

**Files:**
- Modify: `07-advanced-terrain/src/debugPanel.ts`

- [ ] **Step 1: Add the `importPreset()` private method**

  Add this method after `exportPreset()`:

  ```typescript
  private importPreset(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (data.worldImaginerPreset !== true) {
            alert("Not a valid preset file.");
            return;
          }
          const baseName: string = data.name ?? "Imported Preset";
          let candidate = baseName;
          let n = 2;
          while (this.presets.some(p => p.name === candidate)) {
            candidate = `${baseName} (${n++})`;
          }
          this.presets.push({ name: candidate, params: data.params, builtIn: false });
          saveUserPresets(this.presets);
          this.refreshPresetOptions();
          this.presetSelect.value = candidate;
        } catch {
          alert("Failed to read preset file.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }
  ```

- [ ] **Step 2: Add the Import button in `buildPresetRow()`**

  After the `exportBtn` block added in Task 1, add:

  ```typescript
  const importBtn = document.createElement("span");
  importBtn.textContent = "↑";
  importBtn.title = "Import preset";
  importBtn.style.cssText = "background:#0f3460;padding:3px 6px;border-radius:3px;border:1px solid #555;cursor:pointer;font-size:0.65rem;";
  importBtn.addEventListener("click", () => this.importPreset());

  row.appendChild(this.presetSelect);
  row.appendChild(saveBtn);
  row.appendChild(delBtn);
  row.appendChild(exportBtn);
  row.appendChild(importBtn);
  ```

  Replace the previous `row.appendChild` block from Task 1 with the updated one above (all five appends together).

- [ ] **Step 3: Verify manually — happy path**

  1. Export the "Extreme Mountains" preset (↓) to get a `.json` file.
  2. Click ↑, select that file.
  3. Confirm a new preset "Extreme Mountains (2)" appears in the dropdown and is selected.
  4. Load it — parameters should match the original.

- [ ] **Step 4: Verify manually — conflict chaining**

  1. Import the same file again.
  2. Confirm "Extreme Mountains (3)" is created (not "Extreme Mountains (2)" again).

- [ ] **Step 5: Verify manually — invalid file rejection**

  1. Create a plain `.json` file with content `{"foo": 1}`.
  2. Click ↑ and select it.
  3. Confirm an alert says "Not a valid preset file." and nothing is added to the dropdown.

- [ ] **Step 6: Commit**

  ```bash
  git add 07-advanced-terrain/src/debugPanel.ts
  git commit -m "feat: add preset import button (JSON file upload)"
  ```
