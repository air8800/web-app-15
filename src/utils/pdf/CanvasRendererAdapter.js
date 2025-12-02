/**
 * CanvasRendererAdapter - CLEAN CORRECT IMPLEMENTATION
 * 
 * A fresh implementation with correct transformation math.
 * Does NOT replicate legacy bugs - implements the correct algorithm.
 * 
 * TRANSFORMATION ORDER (correct):
 * 1. CROP - Extract source region from original image
 * 2. ROTATE - Rotate the cropped content  
 * 3. SCALE - Scale to fit target, then apply user scale
 * 4. OFFSET - Apply user offset from center
 * 
 * KEY INSIGHT: Crop coordinates from UI are in VISUAL space (what user sees after rotation).
 * We must inverse-rotate crop coords to get the actual source pixels.
 */

/**
 * Feature flag ENABLED - new clean implementation
 */
export const USE_NEW_RENDERER = true

/**
 * Create a renderPageToCanvas function with correct transformation logic
 * 
 * @param {Object} config - Configuration
 * @param {string} config.colorMode - 'BW' or 'Color'
 * @param {Object} config.targetPageSize - { width, height } of target page
 * @returns {Function} renderPageToCanvas function
 */
export function createRenderPageToCanvas(config) {
  const { colorMode = 'Color', targetPageSize } = config

  return function renderPageToCanvas(targetCanvas, sourceOriginalPage, applySettings) {
    const ctx = targetCanvas.getContext('2d', { alpha: false })
    if (!ctx) return

    // Get pristine source (never use already-transformed canvas)
    const sourceCanvas = sourceOriginalPage.pristineOriginal || 
                         sourceOriginalPage.originalCanvas || 
                         sourceOriginalPage.canvas
    
    if (!sourceCanvas) {
      console.error('No source canvas available')
      return
    }

    // Extract settings with safe defaults
    const rotation = normalizeRotation(applySettings.rotation || 0)
    const userScale = (applySettings.scale || 100) / 100
    const offsetX = applySettings.offsetX || 0
    const offsetY = applySettings.offsetY || 0
    const cropArea = applySettings.cropArea || null

    // Original dimensions
    const origW = sourceOriginalPage.width || sourceCanvas.width
    const origH = sourceOriginalPage.height || sourceCanvas.height

    // STEP 1: Calculate source rectangle (inverse-rotate crop if needed)
    const sourceRect = calculateSourceRect(cropArea, rotation, origW, origH)

    // STEP 2: Calculate content dimensions AFTER rotation
    const isSwapped = rotation === 90 || rotation === 270
    const contentW = isSwapped ? sourceRect.height : sourceRect.width
    const contentH = isSwapped ? sourceRect.width : sourceRect.height

    // STEP 3: Calculate scale to fit content in target canvas
    const fitScale = Math.min(
      (targetCanvas.width * 0.95) / contentW,
      (targetCanvas.height * 0.95) / contentH
    )
    const finalScale = fitScale * userScale

    // STEP 4: Calculate final draw size
    const drawW = sourceRect.width * finalScale
    const drawH = sourceRect.height * finalScale

    // Clear and fill white
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)

    // STEP 5: Draw with transformations
    ctx.save()
    
    // Move to center + offset
    ctx.translate(
      targetCanvas.width / 2 + offsetX,
      targetCanvas.height / 2 + offsetY
    )
    
    // Rotate around center
    if (rotation !== 0) {
      ctx.rotate(rotation * Math.PI / 180)
    }
    
    // Draw centered at origin
    ctx.drawImage(
      sourceCanvas,
      sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
      -drawW / 2, -drawH / 2, drawW, drawH
    )
    
    ctx.restore()

    // STEP 6: Apply color filter
    if (colorMode === 'BW') {
      applyGrayscale(ctx, targetCanvas)
    }
  }
}

/**
 * Normalize rotation to 0, 90, 180, or 270
 */
function normalizeRotation(r) {
  return ((r % 360) + 360) % 360
}

/**
 * Calculate the source rectangle in original image coordinates.
 * 
 * The crop from UI is in VISUAL coordinates (what user sees after rotation).
 * We need to inverse-rotate to get actual pixel coordinates in original image.
 * 
 * @param {Object|null} crop - Normalized crop {x, y, width, height} in 0-1 range
 * @param {number} rotation - Normalized rotation (0, 90, 180, 270)
 * @param {number} origW - Original image width
 * @param {number} origH - Original image height
 * @returns {Object} Source rect in original pixel coordinates
 */
function calculateSourceRect(crop, rotation, origW, origH) {
  // No crop = use entire image
  if (!crop) {
    return { x: 0, y: 0, width: origW, height: origH }
  }

  // Visual dimensions (what user sees when rotated)
  const isSwapped = rotation === 90 || rotation === 270
  const viewW = isSwapped ? origH : origW
  const viewH = isSwapped ? origW : origH

  // Convert normalized crop to visual pixel coords
  const vx = crop.x * viewW
  const vy = crop.y * viewH
  const vw = crop.width * viewW
  const vh = crop.height * viewH

  // Inverse-rotate from visual space to original space
  let ox, oy, ow, oh
  
  switch (rotation) {
    case 0:
      // No rotation - visual = original
      ox = vx
      oy = vy
      ow = vw
      oh = vh
      break
      
    case 90:
      // Visual was rotated 90° CW from original
      // To inverse: rotate 90° CCW
      // Visual (vx,vy) → Original (vy, origH - vx - vw)
      ox = vy
      oy = origH - vx - vw
      ow = vh
      oh = vw
      break
      
    case 180:
      // Visual was rotated 180° from original
      // Original point = (origW - vx - vw, origH - vy - vh)
      ox = origW - vx - vw
      oy = origH - vy - vh
      ow = vw
      oh = vh
      break
      
    case 270:
      // Visual was rotated 270° CW (90° CCW) from original
      // To inverse: rotate 90° CW
      // Visual (vx,vy) → Original (origW - vy - vh, vx)
      ox = origW - vy - vh
      oy = vx
      ow = vh
      oh = vw
      break
      
    default:
      ox = vx
      oy = vy
      ow = vw
      oh = vh
  }

  // Clamp to valid bounds
  return clampRect(ox, oy, ow, oh, origW, origH)
}

/**
 * Clamp rectangle to valid image bounds
 */
function clampRect(x, y, w, h, maxW, maxH) {
  const cx = Math.max(0, Math.min(x, maxW - 1))
  const cy = Math.max(0, Math.min(y, maxH - 1))
  const cw = Math.max(1, Math.min(w, maxW - cx))
  const ch = Math.max(1, Math.min(h, maxH - cy))
  return { x: cx, y: cy, width: cw, height: ch }
}

/**
 * Apply grayscale filter to canvas
 */
function applyGrayscale(ctx, canvas) {
  const temp = document.createElement('canvas')
  temp.width = canvas.width
  temp.height = canvas.height
  const tempCtx = temp.getContext('2d')
  
  if (tempCtx) {
    tempCtx.filter = 'grayscale(100%)'
    tempCtx.drawImage(canvas, 0, 0)
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(temp, 0, 0)
  }
}

/**
 * Generate thumbnail from canvas
 */
export function generateThumbnailAdapter(canvas, scale = 0.5, quality = 0.6) {
  if (!canvas) return ''
  
  const thumb = document.createElement('canvas')
  thumb.width = Math.floor(canvas.width * scale)
  thumb.height = Math.floor(canvas.height * scale)
  
  const ctx = thumb.getContext('2d')
  if (!ctx) return ''
  
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height)
  
  return thumb.toDataURL('image/jpeg', quality)
}
