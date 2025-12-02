/**
 * CropService
 * 
 * Handles all crop-related operations.
 * Crop is the FIRST operation in transform order: CROP → ROTATE → SCALE → TRANSLATE
 * 
 * CropBox uses normalized 0-1 coordinates:
 * - x: 0 = left edge, 1 = right edge
 * - y: 0 = top edge, 1 = bottom edge
 * - width/height: fraction of original size
 */

import { CropBox, RotationDegrees } from '../types'
import { MetadataStore } from '../state/metadataStore'

export class CropService {
  private store: MetadataStore

  constructor(store: MetadataStore) {
    this.store = store
  }

  /**
   * Set crop for a page
   */
  setCrop(pageNumber: number, crop: CropBox): boolean {
    const normalized = this.normalizeCrop(crop)
    
    if (!this.validateCrop(normalized)) {
      console.warn(`[CropService] Invalid crop for page ${pageNumber}:`, crop)
      return false
    }

    this.store.setCrop(pageNumber, normalized)
    return true
  }

  /**
   * Get crop for a page
   */
  getCrop(pageNumber: number): CropBox | null {
    return this.store.getCrop(pageNumber)
  }

  /**
   * Clear crop for a page
   */
  clearCrop(pageNumber: number): void {
    this.store.clearCrop(pageNumber)
  }

  /**
   * Check if page has crop
   */
  hasCrop(pageNumber: number): boolean {
    return this.store.getCrop(pageNumber) !== null
  }

  /**
   * Normalize crop values to 0-1 range
   */
  normalizeCrop(crop: CropBox): CropBox {
    return {
      x: Math.max(0, Math.min(1, crop.x)),
      y: Math.max(0, Math.min(1, crop.y)),
      width: Math.max(0.01, Math.min(1, crop.width)),  // min 1% width
      height: Math.max(0.01, Math.min(1, crop.height)) // min 1% height
    }
  }

  /**
   * Validate crop values
   */
  validateCrop(crop: CropBox): boolean {
    // Check bounds
    if (crop.x < 0 || crop.y < 0) return false
    if (crop.width <= 0 || crop.height <= 0) return false
    if (crop.x + crop.width > 1.01) return false  // small tolerance for floating point
    if (crop.y + crop.height > 1.01) return false
    
    return true
  }

  /**
   * Create a default full-page crop
   */
  createFullCrop(): CropBox {
    return { x: 0, y: 0, width: 1, height: 1 }
  }

  /**
   * Create a centered crop with given percentage
   */
  createCenteredCrop(widthPercent: number, heightPercent: number): CropBox {
    const w = Math.max(0.1, Math.min(1, widthPercent))
    const h = Math.max(0.1, Math.min(1, heightPercent))
    return {
      x: (1 - w) / 2,
      y: (1 - h) / 2,
      width: w,
      height: h
    }
  }

  /**
   * Remap crop coordinates when rotation changes
   * This is needed because crop is stored relative to the ORIGINAL page orientation
   * When page rotates, the crop box needs to be remapped
   */
  remapCropForRotation(
    crop: CropBox,
    fromRotation: RotationDegrees,
    toRotation: RotationDegrees
  ): CropBox {
    const delta = ((toRotation - fromRotation) % 360 + 360) % 360

    if (delta === 0) return { ...crop }

    let { x, y, width, height } = crop

    switch (delta) {
      case 90:
        // 90° clockwise: (x,y) -> (1-y-h, x)
        return {
          x: 1 - y - height,
          y: x,
          width: height,
          height: width
        }

      case 180:
        // 180°: (x,y) -> (1-x-w, 1-y-h)
        return {
          x: 1 - x - width,
          y: 1 - y - height,
          width: width,
          height: height
        }

      case 270:
        // 270° clockwise (90° counter-clockwise): (x,y) -> (y, 1-x-w)
        return {
          x: y,
          y: 1 - x - width,
          width: height,
          height: width
        }

      default:
        return { ...crop }
    }
  }

  /**
   * Calculate crop dimensions in pixels
   */
  getCropPixels(
    pageNumber: number,
    displayWidth: number,
    displayHeight: number
  ): { x: number; y: number; width: number; height: number } | null {
    const crop = this.getCrop(pageNumber)
    if (!crop) return null

    return {
      x: crop.x * displayWidth,
      y: crop.y * displayHeight,
      width: crop.width * displayWidth,
      height: crop.height * displayHeight
    }
  }

  /**
   * Convert pixel coordinates to normalized crop
   */
  pixelsToCrop(
    pixelX: number,
    pixelY: number,
    pixelWidth: number,
    pixelHeight: number,
    displayWidth: number,
    displayHeight: number
  ): CropBox {
    return this.normalizeCrop({
      x: pixelX / displayWidth,
      y: pixelY / displayHeight,
      width: pixelWidth / displayWidth,
      height: pixelHeight / displayHeight
    })
  }

  /**
   * Adjust crop by moving a handle
   */
  adjustCropByHandle(
    crop: CropBox,
    handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w',
    deltaX: number,  // normalized 0-1
    deltaY: number   // normalized 0-1
  ): CropBox {
    let { x, y, width, height } = crop

    switch (handle) {
      case 'nw':
        x += deltaX
        y += deltaY
        width -= deltaX
        height -= deltaY
        break
      case 'ne':
        y += deltaY
        width += deltaX
        height -= deltaY
        break
      case 'sw':
        x += deltaX
        width -= deltaX
        height += deltaY
        break
      case 'se':
        width += deltaX
        height += deltaY
        break
      case 'n':
        y += deltaY
        height -= deltaY
        break
      case 's':
        height += deltaY
        break
      case 'w':
        x += deltaX
        width -= deltaX
        break
      case 'e':
        width += deltaX
        break
    }

    return this.normalizeCrop({ x, y, width, height })
  }

  /**
   * Move entire crop box
   */
  moveCrop(crop: CropBox, deltaX: number, deltaY: number): CropBox {
    return this.normalizeCrop({
      x: crop.x + deltaX,
      y: crop.y + deltaY,
      width: crop.width,
      height: crop.height
    })
  }
}
