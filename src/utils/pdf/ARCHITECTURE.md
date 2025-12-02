# PDFEditor Architecture Analysis

## Overview
PDFEditor.jsx (4860 lines) is the edit popup modal for individual page editing.
PDFPageSelector.jsx handles the page grid and thumbnail display.

## 7 Subsystems in PDFEditor.jsx

### 1. Module-Level Caches (lines 30-34)
- `fileLoadCache` - Map to survive React Strict Mode remounts
- Key: `{name}_{size}_{lastModified}`

### 2. React State (lines 50-130)
- `pages`, `originalPages`, `allPages` - page data arrays
- `settings` - current edit settings (rotation, scale, offsetX, offsetY)
- `cropArea`, `pendingCropPreview` - crop system state
- `editingPageIndex`, `editingPageNumber` - current editing page

### 3. PDF Load Pipeline (lines 289-694)
- `loadPDF()` - main loader with AbortController
- Progressive loading: first page → nearby → remaining
- `loadSinglePage()` - on-demand loading for scroll
- IntersectionObserver for lazy loading

### 4. Rendering Helpers
- `applyEdits()` (lines 1419-1691) - main canvas rendering
- `renderPageToCanvas()` (lines 1482-1603) - helper for single page
- Uses `buildCanonicalTransform()` from geometry.ts

### 5. Transformation Logic
- `buildCanonicalTransform()` - geometry.ts line 617
- `buildGeometricTransform()` - geometry.ts line 232
- `remapCropForRotation()` - geometry.ts line 166
- `calculateScaleToFit()` - geometry.ts

### 6. UI Composition (lines 4000+)
- Edit popup with tabs
- Crop mode UI
- Zoom controls
- N-up mode display

### 7. Interop Surface (lines 141-144)
- `useImperativeHandle` exposes `exportPDF`, `clearAllEdits`
- Events for PDFPageSelector communication

## Key Data Flow

```
PDF Load:
file → loadPDF() → renderPage() → pages/originalPages state

Edit Preview:
settings change → applyEdits() → renderPageToCanvas() → buildCanonicalTransform() → canvas draw

Export:
exportPDF() → performFinalizeSave() → buildCanonicalTransform() → pdf-lib operators
```

## Integration Strategy

### Target: Replace renderPageToCanvas with CanvasRenderer adapter

Current signature:
```javascript
const renderPageToCanvas = (targetCanvas, sourceOriginalPage, applySettings) => {
  // Uses buildCanonicalTransform internally
  // Handles crop-only fast path
  // Applies color filter
}
```

Adapter approach:
```javascript
// Create adapter that matches existing signature
const renderPageToCanvasAdapter = (targetCanvas, sourceOriginalPage, applySettings) => {
  // Delegate to new CanvasRenderer
  // Return same result format
}
```

### Phase 1: Create adapters (no changes to PDFEditor.jsx)
### Phase 2: Add feature flag to switch between old/new code
### Phase 3: Replace old code after testing
