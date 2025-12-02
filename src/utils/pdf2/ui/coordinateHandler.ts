/**
 * CoordinateHandler
 * 
 * Handles coordinate transformations between screen, canvas, and source spaces.
 * Extracted from PDFEditor.jsx for modularity.
 * 
 * Key transformations:
 * - Screen coordinates → Canvas coordinates
 * - Canvas coordinates → Source (original page) coordinates
 * - Zoom-aware coordinate conversion
 * - Rotation compensation
 */

export interface CanvasTransformBounds {
  sourceWidth: number
  sourceHeight: number
  finalScale: number
  scaleToFit: number
  contentScale: number
  renderedWidth: number
  renderedHeight: number
  rotation: number
  offsetX: number
  offsetY: number
}

export interface TransformSettings {
  rotation: number
  scale: number
  offsetX: number
  offsetY: number
}

export interface SourceDimensions {
  width: number
  height: number
}

export class CoordinateHandler {
  /**
   * Calculate scale-to-fit for a source in a target canvas
   * Accounts for rotation (90/270 swaps dimensions)
   * 
   * @param canvasWidth - Target canvas width
   * @param canvasHeight - Target canvas height  
   * @param sourceWidth - Source content width
   * @param sourceHeight - Source content height
   * @param rotation - Rotation in degrees (0, 90, 180, 270)
   * @returns Scale factor to fit source in canvas
   */
  calculateScaleToFit(
    canvasWidth: number,
    canvasHeight: number,
    sourceWidth: number,
    sourceHeight: number,
    rotation: number
  ): number {
    const normalizedRotation = ((rotation % 360) + 360) % 360
    const isRotated90or270 = normalizedRotation === 90 || normalizedRotation === 270
    
    if (isRotated90or270) {
      const scaleX = canvasWidth / sourceHeight
      const scaleY = canvasHeight / sourceWidth
      return Math.min(scaleX, scaleY)
    } else {
      const scaleX = canvasWidth / sourceWidth
      const scaleY = canvasHeight / sourceHeight
      return Math.min(scaleX, scaleY)
    }
  }

  /**
   * Calculate canvas transformation bounds
   * EXTRACTED from getCanvasTransformedBounds in PDFEditor.jsx
   * 
   * @param canvasWidth - Canvas width in pixels
   * @param canvasHeight - Canvas height in pixels
   * @param source - Source dimensions and crop state
   * @param settings - Current transform settings
   * @returns Transformation bounds for rendering
   */
  calculateTransformBounds(
    canvasWidth: number,
    canvasHeight: number,
    source: SourceDimensions,
    settings: TransformSettings
  ): CanvasTransformBounds {
    const { width: sourceWidth, height: sourceHeight } = source
    
    const scaleToFit = this.calculateScaleToFit(
      canvasWidth,
      canvasHeight,
      sourceWidth,
      sourceHeight,
      settings.rotation
    )

    const contentScale = settings.scale / 100
    const finalScale = scaleToFit * contentScale

    const renderedWidth = sourceWidth * finalScale
    const renderedHeight = sourceHeight * finalScale

    return {
      sourceWidth,
      sourceHeight,
      finalScale,
      scaleToFit,
      contentScale,
      renderedWidth,
      renderedHeight,
      rotation: settings.rotation,
      offsetX: settings.offsetX,
      offsetY: settings.offsetY
    }
  }

  /**
   * Transform screen coordinates to source (original page) coordinates
   * EXTRACTED from getTransformedCoordinates in PDFEditor.jsx
   * 
   * Handles:
   * - Zoom adjustment
   * - Canvas centering
   * - Offset translation
   * - Rotation compensation
   * - Scale compensation
   * 
   * @param screenX - Screen X coordinate
   * @param screenY - Screen Y coordinate
   * @param containerRect - Container bounding rect
   * @param canvasRect - Canvas bounding rect
   * @param zoom - Current zoom level
   * @param settings - Transform settings (rotation, scale, offsets)
   * @param bounds - Canvas transform bounds
   * @returns Source coordinates { x, y } clamped to source bounds
   */
  screenToSource(
    screenX: number,
    screenY: number,
    containerRect: { left: number; top: number },
    canvasRect: { left: number; top: number; width: number; height: number },
    zoom: number,
    settings: TransformSettings,
    bounds: CanvasTransformBounds
  ): { x: number; y: number } {
    // Convert screen to zoom-independent container coordinates
    const relativeX = (screenX - containerRect.left) / zoom
    const relativeY = (screenY - containerRect.top) / zoom

    // Find canvas center in container space
    const canvasCenterX = (canvasRect.left - containerRect.left + canvasRect.width / 2) / zoom
    const canvasCenterY = (canvasRect.top - containerRect.top + canvasRect.height / 2) / zoom

    // Convert to local coordinates centered on canvas
    let localX = relativeX - canvasCenterX
    let localY = relativeY - canvasCenterY

    // Apply offset compensation
    localX -= settings.offsetX
    localY -= settings.offsetY

    // Apply inverse rotation
    const rotationRad = -(settings.rotation * Math.PI) / 180
    const cos = Math.cos(rotationRad)
    const sin = Math.sin(rotationRad)

    const rotatedX = localX * cos - localY * sin
    const rotatedY = localX * sin + localY * cos

    // Convert to source coordinates
    const sourceX = rotatedX / bounds.finalScale + bounds.sourceWidth / 2
    const sourceY = rotatedY / bounds.finalScale + bounds.sourceHeight / 2

    // Clamp to source bounds
    return {
      x: Math.max(0, Math.min(sourceX, bounds.sourceWidth)),
      y: Math.max(0, Math.min(sourceY, bounds.sourceHeight))
    }
  }

  /**
   * Calculate image rect relative to container
   * EXTRACTED from updateImageRect in PDFEditor.jsx
   * 
   * @param canvasRect - Canvas bounding rect
   * @param containerRect - Container bounding rect
   * @returns Image rect relative to container
   */
  calculateImageRect(
    canvasRect: DOMRect | { left: number; top: number; width: number; height: number },
    containerRect: DOMRect | { left: number; top: number }
  ): { left: number; top: number; width: number; height: number } {
    return {
      left: canvasRect.left - containerRect.left,
      top: canvasRect.top - containerRect.top,
      width: canvasRect.width,
      height: canvasRect.height
    }
  }

  /**
   * Normalize rotation to 0-359 range
   */
  normalizeRotation(rotation: number): number {
    return ((rotation % 360) + 360) % 360
  }

  /**
   * Check if rotation is 90 or 270 degrees (dimensions swap)
   */
  isRotated90or270(rotation: number): boolean {
    const normalized = this.normalizeRotation(rotation)
    return normalized === 90 || normalized === 270
  }

  /**
   * Convert degrees to radians
   */
  degreesToRadians(degrees: number): number {
    return (degrees * Math.PI) / 180
  }

  /**
   * Apply inverse rotation to a point
   * Used to transform from rotated space back to original space
   */
  inverseRotatePoint(
    x: number,
    y: number,
    rotationDegrees: number
  ): { x: number; y: number } {
    const rotationRad = -this.degreesToRadians(rotationDegrees)
    const cos = Math.cos(rotationRad)
    const sin = Math.sin(rotationRad)

    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos
    }
  }

  /**
   * Apply forward rotation to a point
   */
  forwardRotatePoint(
    x: number,
    y: number,
    rotationDegrees: number
  ): { x: number; y: number } {
    const rotationRad = this.degreesToRadians(rotationDegrees)
    const cos = Math.cos(rotationRad)
    const sin = Math.sin(rotationRad)

    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos
    }
  }
}
