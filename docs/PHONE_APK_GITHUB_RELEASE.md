# Phone APK via GitHub Releases

One-click download for the desk **Download phone APK** button (admin / approver).  
Prefer this over Google Drive — Drive blocks silent download of large executables.

Desk config: `sld_editor/license-config.js`  
- **`PHONE_APK_URL`** — direct HTTPS link (use this for Releases)  
- **`PHONE_APK_DRIVE_URL`** — optional Drive fallback (opens “Download anyway”)

---

## What you need

| Item | Notes |
|------|--------|
| Public repo | `UtilityDD/SLMSurvey` must stay **public**, or downloaders need a GitHub login |
| Signed release APK | Build from Android Studio / Gradle (`assembleRelease` or your usual signed flow) |
| GitHub access | Rights to create Releases on the repo (`gh auth login` if using CLI) |

---

## 1. Build the APK

From Android Studio: **Build → Generate Signed Bundle / APK → APK**.  

Or Gradle (adjust flavour/build type if yours differ):

```bash
./gradlew :app:assembleRelease
```

Typical output:

`app/build/outputs/apk/release/app-release.apk`

Rename for the release asset, e.g. `SLMSurvey.apk` (keep the name stable across versions so docs stay simple).

---

## 2. Create a GitHub Release and upload the APK

### Option A — GitHub website

1. Open [github.com/UtilityDD/SLMSurvey/releases](https://github.com/UtilityDD/SLMSurvey/releases)  
2. **Draft a new release**  
3. Create a tag, e.g. `apk-v1.0.0` (or `apk-latest` if you will replace the asset each time)  
4. Title / notes as you like  
5. Attach **`SLMSurvey.apk`** as a binary asset  
6. Publish release  

### Option B — GitHub CLI

```bash
gh auth login
gh release create apk-v1.0.0 ./SLMSurvey.apk \
  --repo UtilityDD/SLMSurvey \
  --title "Phone APK v1.0.0" \
  --notes "Signed release APK for field installs."
```

---

## 3. Copy the asset URL

After publish, the direct download URL is:

```text
https://github.com/UtilityDD/SLMSurvey/releases/download/<TAG>/SLMSurvey.apk
```

Example:

```text
https://github.com/UtilityDD/SLMSurvey/releases/download/apk-v1.0.0/SLMSurvey.apk
```

Check in a private/incognito window: the file should download immediately (no Drive virus page).

---

## 4. Point the desk at that URL

Edit `sld_editor/license-config.js`:

```js
PHONE_APK_URL:
  "https://github.com/UtilityDD/SLMSurvey/releases/download/apk-v1.0.0/SLMSurvey.apk",
PHONE_APK_DRIVE_URL: "",  // optional: clear Drive, or keep as fallback
```

Commit and deploy the desk (GitHub Pages / your usual host). Hard-refresh the desk.

The rail button is shown only when:

- `PHONE_APK_URL` or `PHONE_APK_DRIVE_URL` is set, and  
- license gate is off, **or** the user can approve (`canApprove`)

---

## Updating the APK later

### Stable desk URL (recommended)

Reuse one tag (e.g. `apk-latest`):

1. Delete the old asset on that release (or delete + recreate the release)  
2. Upload the new `SLMSurvey.apk` with the **same filename**  
3. Leave `PHONE_APK_URL` unchanged  

CLI replace pattern:

```bash
gh release delete-asset apk-latest SLMSurvey.apk --repo UtilityDD/SLMSurvey --yes
gh release upload apk-latest ./SLMSurvey.apk --repo UtilityDD/SLMSurvey --clobber
```

### Versioned tags

Create `apk-v1.0.1`, upload the new APK, then update `PHONE_APK_URL` to the new tag path and redeploy the desk.

---

## Checklist

- [ ] Signed release APK built and renamed `SLMSurvey.apk`  
- [ ] GitHub Release published with the APK attached  
- [ ] Asset URL opens/downloads in an incognito window  
- [ ] `PHONE_APK_URL` set in `license-config.js`  
- [ ] Desk redeployed / hard-refreshed  
- [ ] Admin user sees **Download phone APK** and gets the file in one click  

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 404 on download | Tag name or filename mismatch in the URL |
| Login wall | Repo is private — make public or use another host |
| Button hidden | Empty URLs, or user lacks `canApprove` when license is on |
| Still seeing Drive warning | Desk is still using `PHONE_APK_DRIVE_URL`; set `PHONE_APK_URL` to the Releases asset |

---

## Related code

| File | Role |
|------|------|
| `sld_editor/license-config.js` | `PHONE_APK_URL` / `PHONE_APK_DRIVE_URL` |
| `sld_editor/desk/desk.js` | Wires the rail link (`apkDownloadUrl`) |
| `sld_editor/desk/index.html` | `#dkApkDownload` button |
