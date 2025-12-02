/**
 * PDF Geometry Utilities
 * 
 * Pure functions for calculating geometric transformations for PDF pages,
 * including crop, rotation, scale, and offset calculations for both
 * canvas rendering and PDF export.
 * 
 * DESIGN PRINCIPLE: Zero rasterization - all transformations use metadata/vectors only
 */

export interface Dimensions {
  width: number
  height: number
}

export interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

export interface EditHistory {
  cropArea?: CropArea | null
  rotation?: number
  scale?: number
  offsetX?: number
  offsetY?: number
}

export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

export interface GeometricTransform {
  sourceRect: SourceRect
  scaleToFit: number
  finalScale: number
  drawWidth: number
  drawHeight: number
  drawX: number
  drawY: number
  pdfDrawX: number
  pdfDrawY: number
  pdfRotation: number
  offsetX: number
  offsetY: number
}

/**
 * Affine transformation matrix for combining all transformations
 * [a, b, c, d, e, f] represents the PDF transformation matrix:
 * | a  c  e |
 * | b  d  f |
 * | 0  0  1 |
 */
export interface AffineMatrix {
  a: number  // horizontal scaling
  b: number  // horizontal skewing
  c: number  // vertical skewing
  d: number  // vertical scaling
  e: number  // horizontal translation
  f: number  // vertical translation
}

/**
 * CRITICAL: Remap crop coordinates between two different rotation spaces
 * 
 * When a user changes rotation AFTER cropping, the crop coordinates need to be
 * re-expressed in the new rotation's coordinate space.
 * 
 * Strategy:
 * 1. Convert crop from oldRotation space → original page space
 * 2. Convert crop from original page space → newRotation space
 * 
 * @param crop - Crop rectangle in old rotation space (normalized 0-1)
 * @param oldRotation - Previous rotation angle in degrees
 * @param newRotation - New rotation angle in degrees
 * @returns Crop rectangle in new rotation space (normalized 0-1)
 */
/**
 * Forward transform: Convert crop from original page space to rotated canvas space
 * This is the mathematical inverse of remapCropForRotation (which does rotated→original)
 */
function forwardMapCropToRotation(crop: CropArea, rotation: number): CropArea {
  const normalizedRotation = ((rotation % 360) + 360) % 360
  const rotationCase = Math.round(normalizedRotation / 90) * 90
  
  if (rotationCase === 0 || rotationCase === 360) {
    return crop
  }
  
  // Forward transform formulas (original → rotated space)
  // Derived by inverting the backward transform formulas in remapCropForRotation
  switch (rotationCase) {
    case 90:
      // Forward 90° CW: Where does original rect appear after rotating page 90° CW?
      // If backward is: orig_x = 1-(rot_y+rot_h), orig_y = rot_x, dimensions swap
      // Then forward is: rot_x = orig_y, rot_y = 1-(orig_x+orig_w), dimensions swap
      return {
        x: crop.y,
        y: 1 - (crop.x + crop.width),
        width: crop.height,
        height: crop.width
      }
    
    case 180:
      // Forward 180°: Where does original rect appear after rotating page 180°?
      // If backward is: orig_x = 1-(rot_x+rot_w), orig_y = 1-(rot_y+rot_h)
      // Then forward is: rot_x = 1-(orig_x+orig_w), rot_y = 1-(orig_y+orig_h)
      return {
        x: 1 - (crop.x + crop.width),
        y: 1 - (crop.y + crop.height),
        width: crop.width,
        height: crop.height
      }
    
    case 270:
      // Forward 270° CW: Where does original rect appear after rotating page 270° CW?
      // If backward is: orig_x = rot_y, orig_y = 1-(rot_x+rot_w), dimensions swap
      // Then forward is: rot_x = 1-(orig_y+orig_h), rot_y = orig_x, dimensions swap
      return {
        x: 1 - (crop.y + crop.height),
        y: crop.x,
        width: crop.height,
        height: crop.width
      }
    
    default:
      console.warn(`⚠️ Unexpected rotation ${rotationCase}°, using crop as-is`)
      return crop
  }
}

export function remapCropBetweenRotations(
  crop: CropArea, 
  oldRotation: number, 
  newRotation: number
): CropArea {
  // Step 1: Convert crop from old rotation space → original page space (inverse)
  const cropInOriginalSpace = remapCropForRotation(crop, oldRotation)
  
  // Step 2: Convert crop from original page space → new rotation space (forward)
  const cropInNewSpace = forwardMapCropToRotation(cropInOriginalSpace, newRotation)
  
  return cropInNewSpace
}

/**
 * CRITICAL: Remap crop coordinates from rotated canvas space to original page space
 * 
 * When a user rotates THEN crops, the crop coordinates are stored in the rotated
 * canvas coordinate system. But for PDF export, we need to know which part of the
 * ORIGINAL (unrotated) page to sample.
 * 
 * This function performs the inverse transformation to convert crop coordinates
 * from rotated space back to original page space.
 * 
 * @param crop - Crop rectangle in rotated canvas space (normalized 0-1)
 * @param rotation - Rotation angle in degrees (will be normalized to 0/90/180/270)
 * @returns Crop rectangle in original page space (normalized 0-1)
 */
export function remapCropForRotation(crop: CropArea, rotation: number): CropArea {
  // Normalize rotation to 0/90/180/270 range
  const normalizedRotation = ((rotation % 360) + 360) % 360
  const rotationCase = Math.round(normalizedRotation / 90) * 90
  
  // No rotation - crop is already in original space
  if (rotationCase === 0 || rotationCase === 360) {
    return crop
  }
  
  // For rotations, we need to inverse-transform the crop rectangle
  // Think of it as: "where was this rectangle BEFORE we rotated the page?"
  
  switch (rotationCase) {
    case 90:
      // After 90° CW rotation, to find original coordinates (inverse transform):
      // - Original X = 1 - (rotated Y + rotated Height)
      // - Original Y = rotated X
      // - Dimensions swap
      return {
        x: 1 - (crop.y + crop.height),
        y: crop.x,
        width: crop.height,
        height: crop.width
      }
    
    case 180:
      // After 180° rotation, to find original coordinates (inverse transform):
      // - Original X = 1 - (rotated X + rotated Width)
      // - Original Y = 1 - (rotated Y + rotated Height)
      // - Dimensions stay same
      return {
        x: 1 - (crop.x + crop.width),
        y: 1 - (crop.y + crop.height),
        width: crop.width,
        height: crop.height
      }
    
    case 270:
      // After 270° CW rotation (same as 90° CCW), to find original coordinates (inverse transform):
      // - Original X = rotated Y
      // - Original Y = 1 - (rotated X + rotated Width)
      // - Dimensions swap
      return {
        x: crop.y,
        y: 1 - (crop.x + crop.width),
        width: crop.height,
        height: crop.width
      }
    
    default:
      // Shouldn't happen, but fallback to original crop
      console.warn(`⚠️ Unexpected rotation ${rotationCase}°, using crop as-is`)
      return crop
  }
}

/**
 * Builds unified geometric transformation for combining crop, rotation, and scale
 * Returns all parameters needed for both canvas rendering and PDF export
 * 
 * @param originalDims - {width, height} of original uncropped page
 * @param targetDims - {width, height} of target page (usually same as original)
 * @param editHistory - {cropArea, rotation, scale, offsetX, offsetY}
 * @returns Transformation parameters for rendering and export
 */
export const buildGeometricTransform = (
  originalDims: Dimensions,
  targetDims: Dimensions,
  editHistory?: EditHistory | null
): GeometricTransform => {
  const { cropArea, rotation = 0, scale = 100, offsetX = 0, offsetY = 0 } = editHistory || {}
  
  // Step 1: Determine source rectangle (crop region in original page coordinates)
  let sourceRect: SourceRect = {
    x: 0,
    y: 0,
    width: originalDims.width,
    height: originalDims.height
  }
  
  if (cropArea) {
    // CRITICAL: If rotation exists, crop coordinates are in rotated space
    // We need to remap them back to original page space for PDF export
    const cropInOriginalSpace = rotation !== 0 
      ? remapCropForRotation(cropArea, rotation)
      : cropArea
    
    // Log remapping for debugging
    if (rotation !== 0) {
      console.log(`🔄 Remapped crop for ${rotation}° rotation:`, {
        rotatedSpace: cropArea,
        originalSpace: cropInOriginalSpace
      })
    }
    
    sourceRect = {
      x: cropInOriginalSpace.x * originalDims.width,
      y: cropInOriginalSpace.y * originalDims.height,
      width: cropInOriginalSpace.width * originalDims.width,
      height: cropInOriginalSpace.height * originalDims.height
    }
  }
  
  // Step 2: Calculate auto-scale to fit rotated content in target page
  // CRITICAL: For crop, DON'T auto-scale to fill page. Crop should preserve size relationship.
  // Auto-scale only needed for rotation to fit rotated content in fixed page dimensions.
  const normalizedRotation = ((rotation % 360) + 360) % 360
  const isRotated90or270 = normalizedRotation === 90 || normalizedRotation === 270
  
  let scaleToFit: number
  if (rotation !== 0) {
    // ROTATION: Auto-scale to fit rotated content in page
    if (isRotated90or270) {
      // Dimensions are swapped after 90/270° rotation
      const scaleX = targetDims.width / sourceRect.height
      const scaleY = targetDims.height / sourceRect.width
      scaleToFit = Math.min(scaleX, scaleY) * 0.90  // 10% margin to prevent overflow
    } else {
      // For non-90° rotations, use original dimensions for bounding box
      // This is approximate - true bounding box needs cos/sin calculation
      const scaleX = targetDims.width / sourceRect.width
      const scaleY = targetDims.height / sourceRect.height
      scaleToFit = Math.min(scaleX, scaleY) * 0.90  // 10% margin to prevent overflow
    }
  } else {
    // NO ROTATION: No auto-scaling, preserve 1:1 relationship
    scaleToFit = 1
  }
  
  // Step 3: Apply user scale on top of auto-fit
  const userScaleFactor = scale / 100
  const finalScale = scaleToFit * userScaleFactor
  
  // Step 4: Calculate final draw dimensions
  const drawWidth = sourceRect.width * finalScale
  const drawHeight = sourceRect.height * finalScale
  
  // Step 5: Calculate drawing position (centered, with user offset)
  // For canvas: draw centered at origin after ctx.translate to center
  const drawX = -drawWidth / 2
  const drawY = -drawHeight / 2
  
  // Step 6: Build PDF transformation matrix (for pdf-lib export)
  // pdf-lib uses bottom-left origin and counter-clockwise rotation
  const radians = (-rotation * Math.PI) / 180  // Negate for counter-clockwise
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  
  // Calculate rotated offset vector (center to bottom-left corner)
  const vectorX = -drawWidth / 2
  const vectorY = -drawHeight / 2
  const rotatedVectorX = vectorX * cos - vectorY * sin
  const rotatedVectorY = vectorX * sin + vectorY * cos
  
  const pageCenterX = targetDims.width / 2
  const pageCenterY = targetDims.height / 2
  
  const pdfDrawX = pageCenterX + rotatedVectorX + offsetX
  const pdfDrawY = pageCenterY + rotatedVectorY - offsetY  // Flip Y for PDF coords
  
  return {
    sourceRect,           // Crop region in original coordinates
    scaleToFit,          // Auto-fit scale factor
    finalScale,          // Total scale (auto-fit × user scale)
    drawWidth,           // Final width to draw
    drawHeight,          // Final height to draw
    drawX,               // Canvas: drawing X (relative to center)
    drawY,               // Canvas: drawing Y (relative to center)
    pdfDrawX,            // PDF: drawing X (absolute)
    pdfDrawY,            // PDF: drawing Y (absolute)
    pdfRotation: -rotation,  // PDF rotation (counter-clockwise)
    offsetX,             // User offset X
    offsetY              // User offset Y
  }
}

/**
 * Calculate scale to fit dimensions considering rotation
 * 
 * @param sourceWidth - Original width
 * @param sourceHeight - Original height
 * @param targetWidth - Target width
 * @param targetHeight - Target height
 * @param rotation - Rotation angle in degrees
 * @returns Scale factor to fit content in target
 */
export const calculateScaleToFit = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  rotation: number
): number => {
  const normalizedRotation = ((rotation % 360) + 360) % 360
  const isRotated90or270 = normalizedRotation === 90 || normalizedRotation === 270
  
  if (isRotated90or270) {
    // Dimensions are swapped after 90/270° rotation
    const scaleX = targetWidth / sourceHeight
    const scaleY = targetHeight / sourceWidth
    return Math.min(scaleX, scaleY) * 0.90  // 10% margin to prevent overflow
  } else {
    // For 0°/180° or non-90° rotations
    const scaleX = targetWidth / sourceWidth
    const scaleY = targetHeight / sourceHeight
    return Math.min(scaleX, scaleY) * 0.90  // 10% margin to prevent overflow
  }
}

/**
 * Normalize rotation angle to 0-359 range
 * 
 * @param rotation - Rotation angle in degrees (can be negative)
 * @returns Normalized rotation (0-359)
 */
export const normalizeRotation = (rotation: number): number => {
  return ((rotation % 360) + 360) % 360
}

/**
 * Check if rotation is 90 or 270 degrees
 * 
 * @param rotation - Rotation angle in degrees
 * @returns True if rotation is 90 or 270 degrees
 */
export const isRotated90or270 = (rotation: number): boolean => {
  const normalized = normalizeRotation(rotation)
  return normalized === 90 || normalized === 270
}

/**
 * CANONICAL TRANSFORM BUILDER
 * 
 * Normalizes and validates ALL transformations to ensure robustness across
 * any combination of edits: crop + rotation + scale + offset + Apply All
 * 
 * HANDLES EDGE CASES:
 * - Clamps crop rectangles to valid bounds [0, 1]
 * - Prevents negative or zero-area crops
 * - Normalizes rotation to ±180° range (shortest path)
 * - Prevents extreme scales that cause floating-point drift
 * - Clamps offsets to reasonable bounds
 * - Ensures valid clip rectangles for pdf-lib
 * 
 * @param originalDims - Original page dimensions
 * @param editHistory - User's edit settings
 * @returns Validated and normalized crop area
 */
export const normalizeEditHistory = (
  originalDims: Dimensions,
  editHistory?: EditHistory | null
): EditHistory => {
  if (!editHistory) {
    return {
      cropArea: null,
      rotation: 0,
      scale: 100,
      offsetX: 0,
      offsetY: 0
    }
  }

  // 1. NORMALIZE CROP AREA
  let normalizedCropArea: CropArea | null = null
  
  if (editHistory.cropArea) {
    const crop = editHistory.cropArea
    
    // Prevent zero-area or tiny crops (min 1% of page)
    const MIN_CROP_SIZE = 0.01
    
    // Step 1: Enforce minimum size FIRST
    let width = Math.max(MIN_CROP_SIZE, Math.max(0, Math.min(1, crop.width)))
    let height = Math.max(MIN_CROP_SIZE, Math.max(0, Math.min(1, crop.height)))
    
    // Step 2: Clamp coordinates to valid range
    let x = Math.max(0, Math.min(1, crop.x))
    let y = Math.max(0, Math.min(1, crop.y))
    
    // Step 3: CRITICAL - Ensure crop rectangle stays within page bounds [0, 1]
    // If the crop would exceed the right edge, shift it left
    if (x + width > 1) {
      // Try shifting left first (preserves user's intended position better)
      const newX = 1 - width
      if (newX >= 0) {
        x = newX
        console.warn(`⚠️ Crop shifted left to fit within page bounds: x=${x.toFixed(3)}`)
      } else {
        // If can't shift (crop too large), shrink to fit from x=0
        x = 0
        width = 1
        console.warn(`⚠️ Crop too wide for shift, clamped to full width`)
      }
    }
    
    // If the crop would exceed the bottom edge, shift it up
    if (y + height > 1) {
      // Try shifting up first (preserves user's intended position better)
      const newY = 1 - height
      if (newY >= 0) {
        y = newY
        console.warn(`⚠️ Crop shifted up to fit within page bounds: y=${y.toFixed(3)}`)
      } else {
        // If can't shift (crop too tall), shrink to fit from y=0
        y = 0
        height = 1
        console.warn(`⚠️ Crop too tall for shift, clamped to full height`)
      }
    }
    
    // Final validation - ensure we have a valid rectangle
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
      console.error(`❌ Invalid crop rectangle after normalization: x=${x}, y=${y}, w=${width}, h=${height}`)
      // Fallback to safe full-page crop
      normalizedCropArea = { x: 0, y: 0, width: 1, height: 1 }
    } else {
      normalizedCropArea = { x, y, width, height }
    }
  }

  // 2. NORMALIZE ROTATION (-180 to +180, shortest path)
  let normalizedRotation = editHistory.rotation || 0
  
  // Normalize to 0-360 first
  normalizedRotation = ((normalizedRotation % 360) + 360) % 360
  
  // Convert to ±180 range (shortest rotation path)
  if (normalizedRotation > 180) {
    normalizedRotation = normalizedRotation - 360
  }
  
  // Round to nearest 0.1° to prevent floating-point drift
  normalizedRotation = Math.round(normalizedRotation * 10) / 10

  // 3. NORMALIZE SCALE (10% to 500% to prevent extreme values)
  let normalizedScale = editHistory.scale || 100
  const MIN_SCALE = 10
  const MAX_SCALE = 500
  
  if (normalizedScale < MIN_SCALE) {
    console.warn(`⚠️ Scale too small (${normalizedScale}%), clamping to ${MIN_SCALE}%`)
    normalizedScale = MIN_SCALE
  }
  if (normalizedScale > MAX_SCALE) {
    console.warn(`⚠️ Scale too large (${normalizedScale}%), clamping to ${MAX_SCALE}%`)
    normalizedScale = MAX_SCALE
  }

  // 4. NORMALIZE OFFSETS (clamp to ±50% of page dimensions)
  const maxOffsetX = originalDims.width * 0.5
  const maxOffsetY = originalDims.height * 0.5
  
  let normalizedOffsetX = editHistory.offsetX || 0
  let normalizedOffsetY = editHistory.offsetY || 0
  
  if (Math.abs(normalizedOffsetX) > maxOffsetX) {
    console.warn(`⚠️ Offset X too large (${normalizedOffsetX}), clamping to ±${maxOffsetX}`)
    normalizedOffsetX = Math.sign(normalizedOffsetX) * maxOffsetX
  }
  if (Math.abs(normalizedOffsetY) > maxOffsetY) {
    console.warn(`⚠️ Offset Y too large (${normalizedOffsetY}), clamping to ±${maxOffsetY}`)
    normalizedOffsetY = Math.sign(normalizedOffsetY) * maxOffsetY
  }

  return {
    cropArea: normalizedCropArea,
    rotation: normalizedRotation,
    scale: normalizedScale,
    offsetX: normalizedOffsetX,
    offsetY: normalizedOffsetY
  }
}

/**
 * ROBUST AFFINE MATRIX BUILDER
 * 
 * Creates a single affine transformation matrix that combines ALL edits:
 * - Center translation
 * - Rotation
 * - Scale  
 * - Offset
 * 
 * This ensures consistent transformation between preview and export
 * 
 * @param centerX - Center X coordinate
 * @param centerY - Center Y coordinate
 * @param rotation - Rotation in degrees
 * @param scale - Scale factor (1.0 = 100%)
 * @param offsetX - X offset
 * @param offsetY - Y offset
 * @returns Affine transformation matrix
 */
export const buildAffineMatrix = (
  centerX: number,
  centerY: number,
  rotation: number,
  scale: number,
  offsetX: number,
  offsetY: number
): AffineMatrix => {
  // Convert rotation to radians (PDF uses counter-clockwise)
  const radians = (-rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  // Combined transformation matrix:
  // 1. Translate to origin
  // 2. Rotate
  // 3. Scale
  // 4. Translate back with offset
  
  // Rotation + Scale matrix components
  const a = scale * cos
  const b = scale * sin
  const c = -scale * sin
  const d = scale * cos
  
  // Translation component (includes center, rotation, and offset)
  const e = centerX + offsetX - (centerX * a + centerY * c)
  const f = centerY + offsetY - (centerX * b + centerY * d)

  return { a, b, c, d, e, f }
}

/**
 * CANONICAL TRANSFORM BUILDER
 * 
 * ROBUST algorithm for ANY combination of edits with ZERO rasterization
 * 
 * This function:
 * 1. Validates and normalizes ALL edit parameters
 * 2. Builds unified transformation metadata
 * 3. Ensures consistency between UI preview and PDF export
 * 4. Handles edge cases (extreme crops, negative clips, floating-point drift)
 * 
 * TESTED COMBINATIONS:
 * ✓ Crop only
 * ✓ Rotation only  
 * ✓ Scale only
 * ✓ Crop + Rotation
 * ✓ Crop + Scale
 * ✓ Crop + Rotation + Scale
 * ✓ Crop + Rotation + Scale + Offset
 * ✓ Apply All (any of the above to all pages)
 * 
 * @param originalDims - Original page dimensions
 * @param targetDims - Target page dimensions (usually same as original)
 * @param editHistory - User's edit settings
 * @returns Validated transformation with affine matrix
 */
export const buildCanonicalTransform = (
  originalDims: Dimensions,
  targetDims: Dimensions,
  editHistory?: EditHistory | null
): GeometricTransform & { affineMatrix: AffineMatrix } => {
  // Step 1: Normalize and validate all edit parameters
  const normalized = normalizeEditHistory(originalDims, editHistory)
  
  // Step 2: Build standard geometric transform
  const transform = buildGeometricTransform(originalDims, targetDims, normalized)
  
  // Step 3: Build unified affine matrix
  const centerX = targetDims.width / 2
  const centerY = targetDims.height / 2
  const affineMatrix = buildAffineMatrix(
    centerX,
    centerY,
    normalized.rotation || 0,
    transform.finalScale,
    normalized.offsetX || 0,
    normalized.offsetY || 0
  )

  return {
    ...transform,
    affineMatrix
  }
}
