/**
 * CropHandler
 * 
 * Handles all crop-related logic for the PDF editor.
 * Extracted from PDFEditor.jsx for modularity.
 * 
 * ATTACHMENT POINT: Controller exposes applyCrop, getCropArea, computeCenteredCropDrawParams
 */

import { CropBox, RotationDegrees } from '../types'

export interface CropDrawParams {
  drawX: number
  drawY: number
  drawWidth: number
  drawHeight: number
}

export class CropHandler {
  /**
   * Computes centered crop draw parameters for consistent centering across preview, canvas, and PDF export
   * EXACT COPY of the legacy computeCenteredCropDrawParams from PDFEditor.jsx
   * 
   * @param pageWidth - Target page/canvas width (pixels)
   * @param pageHeight - Target page/canvas height (pixels)
   * @param cropWidth - Actual crop width (pixels)
   * @param cropHeight - Actual crop height (pixels)
   * @param fitCropToPage - If true, scale crop to fill page; if false, center at actual size
   * @returns {{ drawX: number, drawY: number, drawWidth: number, drawHeight: number }}
   */
  computeCenteredCropDrawParams(
    pageWidth: number, 
    pageHeight: number, 
    cropWidth: number, 
    cropHeight: number, 
    fitCropToPage: boolean = false
  ): CropDrawParams {
    const marginPercent = 0.05
    const safeWidth = pageWidth * (1 - 2 * marginPercent)
    const safeHeight = pageHeight * (1 - 2 * marginPercent)
    
    if (fitCropToPage) {
      const scaleX = safeWidth / cropWidth
      const scaleY = safeHeight / cropHeight
      const scale = Math.min(scaleX, scaleY)
      
      const drawWidth = cropWidth * scale
      const drawHeight = cropHeight * scale
      const drawX = (pageWidth - drawWidth) / 2
      const drawY = (pageHeight - drawHeight) / 2
      
      console.log(`✂️ CROP CENTERING: page=${pageWidth}×${pageHeight}, safe=${safeWidth.toFixed(1)}×${safeHeight.toFixed(1)}, crop=${cropWidth}×${cropHeight}, scale=${scale.toFixed(3)}, draw at (${drawX.toFixed(1)}, ${drawY.toFixed(1)}) size ${drawWidth.toFixed(1)}×${drawHeight.toFixed(1)} [FIT TO PAGE + 5% MARGIN]`)
      
      return { drawX, drawY, drawWidth, drawHeight }
    } else {
      const scaleX = safeWidth / cropWidth
      const scaleY = safeHeight / cropHeight
      const scale = Math.min(1, scaleX, scaleY)
      
      const drawWidth = cropWidth * scale
      const drawHeight = cropHeight * scale
      const drawX = (pageWidth - drawWidth) / 2
      const drawY = (pageHeight - drawHeight) / 2
      
      if (scale < 1) {
        console.log(`✂️ CROP CENTERING: page=${pageWidth}×${pageHeight}, safe=${safeWidth.toFixed(1)}×${safeHeight.toFixed(1)}, crop=${cropWidth}×${cropHeight}, SCALE DOWN to ${scale.toFixed(3)} (5% margin), draw at (${drawX.toFixed(1)}, ${drawY.toFixed(1)}) size ${drawWidth.toFixed(1)}×${drawHeight.toFixed(1)}`)
      } else {
        console.log(`✂️ CROP CENTERING: page=${pageWidth}×${pageHeight}, safe=${safeWidth.toFixed(1)}×${safeHeight.toFixed(1)}, crop=${cropWidth}×${cropHeight}, NO SCALE (fits in 5% margin), draw at (${drawX.toFixed(1)}, ${drawY.toFixed(1)})`)
      }
      
      return { drawX, drawY, drawWidth, drawHeight }
    }
  }

  /**
   * Validate crop box is within bounds
   */
  validateCropBox(crop: CropBox): CropBox {
    const validated: CropBox = {
      x: Math.max(0, Math.min(1, crop.x)),
      y: Math.max(0, Math.min(1, crop.y)),
      width: Math.max(0.01, Math.min(1, crop.width)),
      height: Math.max(0.01, Math.min(1, crop.height))
    }

    if (validated.x + validated.width > 1) {
      validated.width = 1 - validated.x
    }
    if (validated.y + validated.height > 1) {
      validated.height = 1 - validated.y
    }

    return validated
  }

  /**
   * Create default crop box (full page)
   */
  createDefaultCrop(): CropBox {
    return {
      x: 0,
      y: 0,
      width: 1,
      height: 1
    }
  }

  /**
   * Create centered crop box with margin
   */
  createCenteredCrop(margin: number = 0.1): CropBox {
    return {
      x: margin,
      y: margin,
      width: 1 - margin * 2,
      height: 1 - margin * 2
    }
  }

  /**
   * Transform crop coordinates from visual space to original pixel space
   * Handles rotation compensation
   */
  transformCropToOriginalSpace(
    visualCrop: CropBox,
    rotation: RotationDegrees
  ): CropBox {
    if (rotation === 0) {
      return { ...visualCrop }
    }

    const { x, y, width, height } = visualCrop

    switch (rotation) {
      case 90:
        return {
          x: y,
          y: 1 - x - width,
          width: height,
          height: width
        }
      case 180:
        return {
          x: 1 - x - width,
          y: 1 - y - height,
          width,
          height
        }
      case 270:
        return {
          x: 1 - y - height,
          y: x,
          width: height,
          height: width
        }
      default:
        return { ...visualCrop }
    }
  }

  /**
   * Transform crop coordinates from original pixel space to visual space
   * Inverse of transformCropToOriginalSpace
   */
  transformCropToVisualSpace(
    originalCrop: CropBox,
    rotation: RotationDegrees
  ): CropBox {
    if (rotation === 0) {
      return { ...originalCrop }
    }

    const { x, y, width, height } = originalCrop

    switch (rotation) {
      case 90:
        return {
          x: 1 - y - height,
          y: x,
          width: height,
          height: width
        }
      case 180:
        return {
          x: 1 - x - width,
          y: 1 - y - height,
          width,
          height
        }
      case 270:
        return {
          x: y,
          y: 1 - x - width,
          width: height,
          height: width
        }
      default:
        return { ...originalCrop }
    }
  }

  /**
   * Check if two crop boxes are equal
   */
  cropBoxesEqual(a: CropBox | null, b: CropBox | null): boolean {
    if (a === null && b === null) return true
    if (a === null || b === null) return false
    
    const epsilon = 0.0001
    return (
      Math.abs(a.x - b.x) < epsilon &&
      Math.abs(a.y - b.y) < epsilon &&
      Math.abs(a.width - b.width) < epsilon &&
      Math.abs(a.height - b.height) < epsilon
    )
  }

  /**
   * Check if crop box covers the entire page (effectively no crop)
   */
  isFullPageCrop(crop: CropBox | null): boolean {
    if (!crop) return true
    
    const epsilon = 0.0001
    return (
      Math.abs(crop.x) < epsilon &&
      Math.abs(crop.y) < epsilon &&
      Math.abs(crop.width - 1) < epsilon &&
      Math.abs(crop.height - 1) < epsilon
    )
  }

  /**
   * Get aspect ratio of crop box
   */
  getCropAspectRatio(crop: CropBox): number {
    return crop.width / crop.height
  }

  /**
   * Constrain crop to specific aspect ratio
   */
  constrainToAspectRatio(crop: CropBox, aspectRatio: number): CropBox {
    const currentRatio = crop.width / crop.height
    
    if (currentRatio > aspectRatio) {
      const newWidth = crop.height * aspectRatio
      return {
        ...crop,
        x: crop.x + (crop.width - newWidth) / 2,
        width: newWidth
      }
    } else {
      const newHeight = crop.width / aspectRatio
      return {
        ...crop,
        y: crop.y + (crop.height - newHeight) / 2,
        height: newHeight
      }
    }
  }

  /**
   * Initialize crop area in canvas pixel space
   * EXACT COPY of startCrop initialization from PDFEditor.jsx
   * 
   * @param canvasWidth - Canvas width in pixels
   * @param canvasHeight - Canvas height in pixels
   * @param margin - Margin percentage (default 0.1 = 10% from edges)
   * @returns Crop area in canvas pixel coordinates
   */
  initializeCropArea(
    canvasWidth: number,
    canvasHeight: number,
    margin: number = 0.1
  ): { x: number; y: number; width: number; height: number } {
    // Initialize crop at 80% of canvas size, centered (10% margin on each side)
    const cropWidth = canvasWidth * (1 - margin * 2)
    const cropHeight = canvasHeight * (1 - margin * 2)
    
    const cropX = (canvasWidth - cropWidth) / 2
    const cropY = (canvasHeight - cropHeight) / 2
    
    return {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight
    }
  }

  /**
   * Convert pixel crop area to normalized (0-1) coordinates
   */
  pixelToNormalized(
    pixelCrop: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number
  ): CropBox {
    return {
      x: pixelCrop.x / canvasWidth,
      y: pixelCrop.y / canvasHeight,
      width: pixelCrop.width / canvasWidth,
      height: pixelCrop.height / canvasHeight
    }
  }

  /**
   * Convert normalized (0-1) coordinates to pixel crop area
   */
  normalizedToPixel(
    normalizedCrop: CropBox,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number; width: number; height: number } {
    return {
      x: normalizedCrop.x * canvasWidth,
      y: normalizedCrop.y * canvasHeight,
      width: normalizedCrop.width * canvasWidth,
      height: normalizedCrop.height * canvasHeight
    }
  }

  /**
   * Constrain crop area to stay within canvas bounds
   */
  constrainToCanvas(
    crop: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
    minSize: number = 20
  ): { x: number; y: number; width: number; height: number } {
    let { x, y, width, height } = crop
    
    // Ensure minimum size
    width = Math.max(minSize, width)
    height = Math.max(minSize, height)
    
    // Constrain to canvas bounds
    x = Math.max(0, Math.min(x, canvasWidth - width))
    y = Math.max(0, Math.min(y, canvasHeight - height))
    
    // Ensure width/height don't exceed canvas
    width = Math.min(width, canvasWidth - x)
    height = Math.min(height, canvasHeight - y)
    
    return { x, y, width, height }
  }

  /**
   * Enforce minimum size on crop dimensions
   * EXTRACTED from handleMouseMove logic in PDFEditor.jsx
   */
  enforceMinSize(
    value: number,
    minSize: number = 50
  ): number {
    return Math.max(minSize, value)
  }

  /**
   * Clamp a value to a range
   * EXTRACTED from handleMouseMove logic in PDFEditor.jsx
   */
  clampValue(
    value: number,
    min: number,
    max: number
  ): number {
    return Math.max(min, Math.min(value, max))
  }

  /**
   * Apply boundary constraints to crop area with margin
   * EXACT COPY of boundary enforcement logic from PDFEditor.jsx handleMouseMove
   * 
   * @param crop - Current crop area in canvas pixels
   * @param canvasWidth - Canvas width in pixels
   * @param canvasHeight - Canvas height in pixels
   * @param margin - Margin from edges (default 10)
   * @param minSize - Minimum crop size (default 50)
   */
  enforceBoundaries(
    crop: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
    margin: number = 10,
    minSize: number = 50
  ): { x: number; y: number; width: number; height: number } {
    let { x, y, width, height } = crop
    
    // Enforce canvas pixel boundaries
    x = Math.max(margin, Math.min(x, canvasWidth - minSize - margin))
    y = Math.max(margin, Math.min(y, canvasHeight - minSize - margin))
    width = Math.max(minSize, Math.min(width, canvasWidth - x - margin))
    height = Math.max(minSize, Math.min(height, canvasHeight - y - margin))

    // Final boundary check
    if (x + width > canvasWidth - margin) {
      width = canvasWidth - x - margin
    }
    if (y + height > canvasHeight - margin) {
      height = canvasHeight - y - margin
    }
    
    return { x, y, width, height }
  }

  /**
   * Normalize crop bounds for extraction from canvas
   * EXTRACTED from applyCrop in PDFEditor.jsx
   * 
   * Handles edge cases:
   * - Negative coordinates (crop extends past top/left edge)
   * - Crop extending past canvas boundaries
   * - Ensures minimum valid dimensions
   * 
   * @param cropArea - Raw crop area with potential overshoot
   * @param canvasWidth - Source canvas width
   * @param canvasHeight - Source canvas height
   * @returns Normalized crop bounds ready for canvas extraction, or null if invalid
   */
  normalizeCropBounds(
    cropArea: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number; width: number; height: number; isValid: boolean } {
    let cropX = Math.round(cropArea.x)
    let cropY = Math.round(cropArea.y)
    let cropWidth = Math.round(cropArea.width)
    let cropHeight = Math.round(cropArea.height)
    
    // Adjust for top overshoot (negative Y)
    if (cropY < 0) {
      cropHeight += cropY
      cropY = 0
    }
    
    // Adjust for left overshoot (negative X)
    if (cropX < 0) {
      cropWidth += cropX
      cropX = 0
    }
    
    // Clamp to canvas boundaries
    cropWidth = Math.min(cropWidth, canvasWidth - cropX)
    cropHeight = Math.min(cropHeight, canvasHeight - cropY)
    
    // Guard against extreme overshoot producing invalid dimensions
    cropWidth = Math.max(1, cropWidth)
    cropHeight = Math.max(1, cropHeight)
    
    // Check if crop is valid (minimum size after normalization)
    const isValid = cropWidth >= 10 && cropHeight >= 10
    
    console.log(`✂️ Normalized crop bounds: (${cropX}, ${cropY}) ${cropWidth}×${cropHeight} on canvas ${canvasWidth}×${canvasHeight} [valid: ${isValid}]`)
    
    return { x: cropX, y: cropY, width: cropWidth, height: cropHeight, isValid }
  }

  /**
   * Calculate normalized (0-1) crop area from pixel coordinates
   * EXTRACTED from applyCrop in PDFEditor.jsx
   * 
   * @param pixelCrop - Crop in pixel coordinates
   * @param canvasWidth - Canvas width for normalization
   * @param canvasHeight - Canvas height for normalization
   * @returns Normalized crop coordinates (0-1 range)
   */
  createNormalizedCropArea(
    pixelCrop: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number
  ): CropBox {
    return {
      x: pixelCrop.x / canvasWidth,
      y: pixelCrop.y / canvasHeight,
      width: pixelCrop.width / canvasWidth,
      height: pixelCrop.height / canvasHeight
    }
  }

  /**
   * Calculate rotation delta needed to reset to 0°
   * EXTRACTED from resetSettings in PDFEditor.jsx
   * 
   * @param currentRotation - Current rotation in degrees (0, 90, 180, 270)
   * @returns Delta rotation needed to return to 0°
   */
  calculateResetRotationDelta(currentRotation: number): number {
    return (360 - currentRotation) % 360
  }

  /**
   * Calculate new rotation after applying a delta
   * 
   * @param currentRotation - Current rotation in degrees
   * @param deltaRotation - Rotation delta to apply (positive = clockwise)
   * @returns New rotation normalized to 0-359
   */
  calculateNewRotation(currentRotation: number, deltaRotation: number): number {
    return (currentRotation + deltaRotation + 360) % 360
  }
}
