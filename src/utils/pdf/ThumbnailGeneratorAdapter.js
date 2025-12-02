/**
 * ThumbnailGeneratorAdapter
 * 
 * Adapter for thumbnail generation that matches the existing interface
 * used throughout PDFEditor.jsx and PDFPageSelector.jsx.
 * 
 * This wraps the thumbnail generation logic into a reusable module.
 */

/**
 * Generate a thumbnail from a canvas
 * Matches the existing generateThumbnail function signature from rendering.ts
 * 
 * @param {HTMLCanvasElement} canvas - Source canvas
 * @param {number} scale - Scale factor (0.5 = half size)
 * @param {number} quality - JPEG quality (0.4-1.0)
 * @returns {string} Data URL of thumbnail
 */
export function generateThumbnail(canvas, scale = 0.5, quality = 0.6) {
  if (!canvas) return ''
  
  const thumbCanvas = document.createElement('canvas')
  thumbCanvas.width = Math.round(canvas.width * scale)
  thumbCanvas.height = Math.round(canvas.height * scale)
  
  const thumbCtx = thumbCanvas.getContext('2d', { alpha: false })
  if (!thumbCtx) return ''
  
  thumbCtx.imageSmoothingEnabled = true
  thumbCtx.imageSmoothingQuality = 'medium'
  thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height)
  
  return thumbCanvas.toDataURL('image/jpeg', quality)
}

/**
 * Thumbnail quality presets
 */
export const THUMBNAIL_PRESETS = {
  fast: { scale: 0.3, quality: 0.4 },
  standard: { scale: 0.5, quality: 0.6 },
  high: { scale: 0.75, quality: 0.8 }
}

/**
 * Generate thumbnail with preset
 */
export function generateThumbnailWithPreset(canvas, preset = 'standard') {
  const config = THUMBNAIL_PRESETS[preset] || THUMBNAIL_PRESETS.standard
  return generateThumbnail(canvas, config.scale, config.quality)
}

/**
 * ThumbnailGenerator class for batch operations
 */
export class ThumbnailGenerator {
  constructor(config = {}) {
    this.scale = config.scale || 0.5
    this.quality = config.quality || 0.6
    this.cache = new Map()
  }

  /**
   * Generate thumbnail with caching
   */
  generate(canvas, pageNumber = null) {
    if (!canvas) return ''
    
    // Check cache
    if (pageNumber !== null && this.cache.has(pageNumber)) {
      return this.cache.get(pageNumber)
    }
    
    const thumbnail = generateThumbnail(canvas, this.scale, this.quality)
    
    // Cache result
    if (pageNumber !== null) {
      this.cache.set(pageNumber, thumbnail)
    }
    
    return thumbnail
  }

  /**
   * Invalidate cached thumbnail for a page
   */
  invalidate(pageNumber) {
    this.cache.delete(pageNumber)
  }

  /**
   * Clear all cached thumbnails
   */
  clearCache() {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    }
  }
}

/**
 * Create a thumbnail generator instance
 */
export function createThumbnailGenerator(config) {
  return new ThumbnailGenerator(config)
}
