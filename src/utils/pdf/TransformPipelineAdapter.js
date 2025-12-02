/**
 * TransformPipelineAdapter
 * 
 * Adapter layer that provides a clean interface for transformation operations.
 * This wraps the existing geometry.ts functions behind a pipeline pattern.
 * 
 * DESIGN PRINCIPLE: This is for the DESKTOP PRINT ENGINE architecture.
 * The web app only provides VISUAL PREVIEW - the actual PDF transformation
 * happens on the desktop engine which receives JSON recipe + original file.
 * 
 * This adapter generates the transformation recipe that gets sent to the desktop engine.
 */

import { 
  buildCanonicalTransform, 
  buildGeometricTransform,
  remapCropBetweenRotations,
  calculateScaleToFit 
} from './geometry'

/**
 * TransformPipeline - manages transformation state and generates recipes
 */
export class TransformPipeline {
  constructor(originalDims, targetDims) {
    this.originalDims = originalDims
    this.targetDims = targetDims
    this.transforms = []
    this.editHistory = {
      rotation: 0,
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      cropArea: null
    }
  }

  /**
   * Set rotation in degrees (0, 90, 180, 270)
   */
  setRotation(degrees) {
    const normalized = ((degrees % 360) + 360) % 360
    
    // If crop exists and rotation is changing, remap the crop
    if (this.editHistory.cropArea && this.editHistory.rotation !== normalized) {
      this.editHistory.cropArea = remapCropBetweenRotations(
        this.editHistory.cropArea,
        this.editHistory.rotation,
        normalized
      )
    }
    
    this.editHistory.rotation = normalized
    this.transforms.push({ type: 'rotation', degrees: normalized, timestamp: Date.now() })
    return this
  }

  /**
   * Set scale percentage (100 = original size)
   */
  setScale(percentage) {
    this.editHistory.scale = percentage
    this.transforms.push({ type: 'scale', percentage, timestamp: Date.now() })
    return this
  }

  /**
   * Set offset in pixels
   */
  setOffset(x, y) {
    this.editHistory.offsetX = x
    this.editHistory.offsetY = y
    this.transforms.push({ type: 'offset', x, y, timestamp: Date.now() })
    return this
  }

  /**
   * Set crop area (normalized 0-1 coordinates)
   */
  setCrop(cropArea) {
    this.editHistory.cropArea = cropArea
    this.transforms.push({ type: 'crop', area: cropArea, timestamp: Date.now() })
    return this
  }

  /**
   * Clear all transformations
   */
  reset() {
    this.editHistory = {
      rotation: 0,
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      cropArea: null
    }
    this.transforms = []
    return this
  }

  /**
   * Get the computed geometric transform for canvas rendering
   */
  getCanvasTransform() {
    return buildCanonicalTransform(
      this.originalDims,
      this.targetDims,
      this.editHistory
    )
  }

  /**
   * Get the current edit state (for persistence)
   */
  getEditHistory() {
    return { ...this.editHistory }
  }

  /**
   * Generate recipe for desktop print engine
   * This is the JSON that gets sent with the original file
   */
  generateRecipe() {
    return {
      version: '1.0',
      originalDimensions: this.originalDims,
      targetDimensions: this.targetDims,
      edits: this.editHistory,
      transformHistory: this.transforms,
      generatedAt: new Date().toISOString()
    }
  }
}

/**
 * Create a transform pipeline for a page
 * 
 * @param {Object} page - Page object with width, height, editHistory
 * @param {Object} targetPageSize - Target page dimensions
 * @returns {TransformPipeline}
 */
export function createPipelineForPage(page, targetPageSize) {
  const pipeline = new TransformPipeline(
    { width: page.width, height: page.height },
    targetPageSize
  )
  
  // Restore existing edit history if present
  if (page.editHistory) {
    if (page.editHistory.rotation) pipeline.editHistory.rotation = page.editHistory.rotation
    if (page.editHistory.scale) pipeline.editHistory.scale = page.editHistory.scale
    if (page.editHistory.offsetX) pipeline.editHistory.offsetX = page.editHistory.offsetX
    if (page.editHistory.offsetY) pipeline.editHistory.offsetY = page.editHistory.offsetY
    if (page.editHistory.cropArea) pipeline.editHistory.cropArea = page.editHistory.cropArea
  }
  
  return pipeline
}

/**
 * Compute auto-fit scale for a rotation
 * Matches the existing calculateScaleToFit behavior
 */
export function computeAutoFitScale(originalWidth, originalHeight, targetWidth, targetHeight, rotation) {
  return calculateScaleToFit(originalWidth, originalHeight, targetWidth, targetHeight, rotation)
}
