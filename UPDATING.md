# Updating Conveyer Isabell

When a new version is published on GitHub, you can pull the changes without losing
your API keys, custom prompts, or generated runs. Your data lives in a separate
database **outside** the project folder, so replacing or updating the project never
touches it.

This guide covers all four combinations:

- [macOS · downloaded as ZIP](#macos--downloaded-as-zip)
- [macOS · using git clone](#macos--using-git-clone)
- [Windows · downloaded as ZIP](#windows--downloaded-as-zip)
- [Windows · using git clone](#windows--using-git-clone)

If you're not sure which method you used originally, check your project folder:
if there's a hidden `.git` folder inside, you used **git**. Otherwise it's a **ZIP**.

---

## What gets updated vs preserved

```
🏠 Your home folder
│
├── 📁 ~/.conveyer-isabell/        ← NEVER touched by updates
│   ├── 📄 isabell.db                  ← all your data lives here:
│   │                                    • API keys (Google, 69labs)
│   │                                    • custom prompts
│   │                                    • run history
│   │                                    • every setting you changed
│   │
│   └── 📁 runs/                       ← all generated files:
│       ├── 📁 My first test/
│       │   ├── 📄 final.mp4
│       │   ├── 📁 audio/   (mp3s)
│       │   ├── 📁 images/  (pngs)
│       │   └── 📁 clips/
│       └── 📁 other runs...
│
└── 📁 Documents/Conveyer/          ← THIS is what gets replaced/updated
    ├── 📁 src/                         (just code)
    ├── 📁 node_modules/                (libraries — reinstalled if needed)
    ├── 📄 start.command
    ├── 📄 package.json
    └── ... (no personal data here)
```

**Rule of thumb:** the project folder only contains code logic. Everything you
personally entered or generated lives in `~/.conveyer-isabell/` and stays put.

---

## macOS · downloaded as ZIP

### 1. Stop the running server

If `start.command` is still running, close its Terminal window or press Ctrl+C
inside it. Or double-click `stop.command` in your current project folder.

### 2. Rename your current project folder

In Finder, find your existing `Conveyer-main` (or `Conveyer`) folder.
Right-click → **Rename** → call it something like `Conveyer-OLD` so you don't
mix things up.

### 3. Download the new ZIP

1. Open https://github.com/Bander4ik/Conveyer in your browser.
2. Click the green **"< > Code"** button (top-right of the file list).
3. Click **"Download ZIP"** at the bottom of the dropdown.
4. The file `Conveyer-main.zip` lands in your Downloads folder.

### 4. Extract and move it into place

1. In Downloads, double-click `Conveyer-main.zip`. macOS unzips it into a
   folder called `Conveyer-main`.
2. Drag that folder to wherever you keep the project (e.g. `~/Documents/`).
3. Rename it back to whatever name you had before (so any shortcuts still work).

### 5. Restore executable permissions on the launchers

macOS strips the executable flag during ZIP extraction. Open Terminal
(⌘+Space → "Terminal") and run:

```bash
cd ~/Documents/Conveyer
chmod +x *.command
```

(Replace `~/Documents/Conveyer` with your actual path. **Tip:** type `cd ` with
a trailing space, then drag the folder from Finder into Terminal — it auto-fills
the path. Press Enter.)

### 6. Reinstall dependencies

Double-click `install.command` in the new folder. Terminal downloads ~100 MB of
helper code (1–3 minutes).

> **If macOS Gatekeeper blocks it:** right-click `install.command` → **Open**
> → click **Open** in the warning dialog. macOS remembers after the first
> approval.

### 7. Start the new version

Double-click `start.command`. Your browser opens at http://localhost:3000.

### 8. Verify your data is still there

- **Keys & Settings** — your `GOOGLE_API_KEY` and `LABS69_API_KEY` should
  still be there (shown as `AIzaS…x7Ag` etc).
- **Prompts** — any prompts you customized are still there.
- **Run history** — all your previous runs are accessible.
- New fields from the update appear with default values.

### 9. Delete the old folder (after you verify)

Once you've confirmed everything in step 8, drag `Conveyer-OLD` to Trash and
empty it. It contains ~200 MB of obsolete `node_modules` plus the old code.

---

## macOS · using git clone

### 1. Stop the running server (same as above)

### 2. Pull the latest changes

Open Terminal and run:

```bash
cd ~/Documents/Conveyer    # or wherever you cloned it
git pull
```

If `git pull` reports "local changes would be overwritten", run this first:

```bash
git stash
git pull
```

That sets aside any accidental local edits — they're not your settings, so
nothing important is lost.

### 3. Make sure launchers are still executable

```bash
chmod +x *.command
```

(Usually unnecessary because git preserves the executable bit, but harmless.)

### 4. Start the updated version

Double-click `start.command`. Browser opens at http://localhost:3000.

That's it — no reinstall step needed unless `package.json` changed (in which
case `start.command` runs `npm install` automatically).

---

## Windows · downloaded as ZIP

### 1. Stop the running server

If `start.bat` is still running, close its black window or press Ctrl+C in it.
Or double-click `stop.bat` in your current project folder.

### 2. Rename your current project folder

In File Explorer, right-click your existing `Conveyer-main` (or `Conveyer`)
folder → **Rename** → `Conveyer-OLD`.

### 3. Download the new ZIP

1. Open https://github.com/Bander4ik/Conveyer in your browser.
2. Click **"< > Code"** → **"Download ZIP"**.
3. Save to Downloads.

### 4. Extract it into place

1. Right-click `Conveyer-main.zip` → **Extract All...** → pick the same
   location your project was in (e.g. `C:\YouTube\`) → **Extract**.
2. Rename the new `Conveyer-main` folder to whatever name you had before.

### 5. Reinstall dependencies

Double-click `install.bat` in the new folder. A black window opens and
downloads ~100 MB of helper code (1–3 minutes). When it says "Done!", close.

### 6. Start the new version

Double-click `start.bat`. Your browser opens at http://localhost:3000.

### 7. Verify your data

Same as macOS step 8 above — open Keys & Settings, Prompts, Run history. Your
data is preserved because the database lives in `C:\Users\YOU\.conveyer-isabell\`,
which we never touched.

### 8. Delete the old folder

Drag `Conveyer-OLD` to the Recycle Bin once you're sure the new version is
fine. It only contains code and node_modules — no personal data.

---

## Windows · using git clone

### 1. Stop the running server (same as above)

### 2. Pull the latest changes

Open PowerShell (Start menu → "PowerShell") and run:

```powershell
cd "C:\YouTube\Conveyer"    # or wherever you cloned it
git pull
```

If `git pull` complains about local changes:

```powershell
git stash
git pull
```

### 3. Start the updated version

Double-click `start.bat`. Browser opens at http://localhost:3000.

If `package.json` changed in the update, the launcher will auto-run
`npm install` for you on first boot.

---

## Troubleshooting

### "Permission denied" when running `.command` on Mac
You skipped the `chmod +x *.command` step. Open Terminal, navigate to the
project folder, and run it.

### "cannot be opened because it is from an unidentified developer" (macOS Gatekeeper)
Right-click the `.command` file → **Open** → click **Open** in the dialog.
This is a one-time approval per file.

### Port 3000 is already in use
A previous server is still alive. Double-click `stop.command` (Mac) or
`stop.bat` (Windows), then start again.

### My new field doesn't appear in Keys & Settings
The platform seeds defaults for new fields on server start. If you don't see
the new field, make sure you fully stopped the old server before starting the
new one. The seed only runs when the dev server boots fresh.

### I see "node_modules not found" on first start
That's normal — the launcher detects this and runs `npm install` automatically.
Just wait 1–3 minutes.

### I want to back up my data before updating (peace of mind)
- **macOS:** Open Finder → ⌘+Shift+G → paste `~/.conveyer-isabell/` →
  right-click the folder → **Compress** to make a ZIP backup.
- **Windows:** open File Explorer → paste `%USERPROFILE%\.conveyer-isabell\`
  in the address bar → right-click → **Send to → Compressed (zipped) folder**.

You don't need this step — updates physically can't reach that folder — but it
never hurts.

---

## Why your data is safe (technical detail, optional reading)

The platform stores two completely separate things in two completely separate
places:

| What | Where | Touched by updates? |
|---|---|---|
| Source code & launchers | The project folder you downloaded | ✅ replaced by update |
| API keys, prompts, settings, runs | `~/.conveyer-isabell/` in your home directory | ❌ never touched |

The Node.js server reads the database from your home directory regardless of
where the project folder is. So if you replace the project folder with a new
version, the new code reads the same database and finds everything you
configured exactly as you left it.

This is the same pattern most desktop apps use: the program lives in
`Applications` (or `Program Files`) and gets replaced with each update, while
your personal data lives in `~/Library` (or `AppData`) and survives forever.
