# Photo Upload Fix — Results

## Root Cause

The photo upload failure had **two cascading causes**:

### 1. eBay's Helix Photo Framework (Primary)
On eBay's new listing form (`.com.au`), when a listing has **variations** (multi-SKU), eBay transforms the photo section:
- The "Photos & Video" section becomes just "Video"
- The file input (`#fehelix-uploader`) changes its `accept` attribute from `image/*,...` to `video/mp4,video/quicktime`
- Main listing photos are supposed to be managed inside the Variations editor

This means **all 4 existing upload methods fail** on variation listings:
- **Method 1 (File Input)**: The file input only accepts video, so DataTransfer with image files is rejected by eBay's internal upload handler
- **Method 2 (Drag-and-Drop)**: The dropzone is for video only
- **Method 3 (eBay Media API)**: Endpoints return 404 or "Failed to fetch"
- **Method 4 (Draft API PUT)**: Returns `{"reload":true}` but doesn't actually associate photos

### 2. Uploader Config Closure (Secondary)
Even if the file input's `accept` attribute is modified, eBay's upload handler has a **closure** over the original config from `setup()` time. The change event handler passes this closed-over config to `uploadFiles()`, which then validates files against `config.accept` and `config.acceptImage`. Since the original config says `acceptImage: false`, image files are rejected with `INVALIDFILE`.

## The Fix

Added **Method 0 (Preferred): Direct Helix Uploader** in `form-filler.js`:

1. Access `window.sellingUIUploader['fehelix-uploader']` — eBay's global uploader instance
2. Create a **modified config object** with `acceptImage: true`, `accept: 'image/*,...'`, `maxImages: 24`
3. Call `uploader.uploadFiles(files, 'select', modifiedConfig, counts)` directly — **bypassing the file input entirely** and the closure over the old config
4. The uploader uploads each image to EPS (eBay Picture Services) and emits `upload-success` events
5. The Marko component receives the events and associates the uploaded images with the listing draft

Also added **Method 5: Direct EPS Upload** as a last-resort fallback that uploads images directly to eBay's EPS endpoint (`/image/upload/eBayISAPI.dll?EpsBasic`) via XHR with the correct authentication tokens (uaek, uaes) extracted from the page's inline scripts.

## Files Modified

- `extension/content-scripts/ebay/form-filler.js`
  - Added `uploadViaHelixUploader()` — Method 0 (preferred)
  - Added `uploadViaEpsDirect()` — Method 5 (fallback)
  - Added `countUploadedPhotosFromDraft()` — helper function
  - Reordered upload methods: Helix → File Input → Drag-Drop → Media API → Draft PUT → EPS Direct
  - Removed non-working "preferred first path" draft API PUT with external URLs

## Test Results

### On variation listing (draftId=5054292507820)
- **Before fix**: 0 photos uploaded across all methods
- **After fix**: Photos upload successfully via Helix uploader
  - `upload-success` event fires with valid `fId` (eBay file ID)
  - Photos appear in draft data at `PHOTOS.photosInput.photos[]`
  - eBay-hosted URLs generated (e.g., `https://i.ebayimg.com/00/s/...`)

### On non-variation listing (draftId=5053798596022)
- Both file chooser and DataTransfer methods work (accept includes images)
- The Helix uploader method also works as an additional path

## Key Technical Details

- **EPS Upload**: POST to `/image/upload/eBayISAPI.dll?EpsBasic` with FormData containing `file`, `s=SuperSize`, `n=i`, `v=2`, `aXRequest=2`, `uaek`, `uaes`. Returns `VERSION:2;{ebayimg_url}`.
- **Helix uploader** (`window.sellingUIUploader`): Global object with `uploadFiles(files, type, config, counts)` method
- **Image min resolution**: 500x500 (from EPS config)
- **Pre-downloaded images** from AliExpress content script still work when available
- **FETCH_IMAGE** via service worker still works as fallback for fetching images

## What's NOT Fixed (Separate Issue)
- **Variation-specific photo upload** (inside the Variations editor dialog) — this uses a different mechanism and is a separate feature
