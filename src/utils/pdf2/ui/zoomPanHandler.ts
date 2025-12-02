/**
 * ZoomPanHandler
 * 
 * Handles zoom and pan calculations for the PDF editor canvas.
 * Extracted from PDFEditor.jsx for modularity.
 * 
 * Key features:
 * - Zoom level clamping and stepping
 * - Pan bounds calculation
 * - Zoom-to-point transformations
 */

export interface ZoomConfig {
  minZoom: number
  maxZoom: number
  zoomStep: number
}

export const DEFAULT_ZOOM_CONFIG: ZoomConfig = {
  minZoom: 0.5,
  maxZoom: 2.0,
  zoomStep: 0.25
}

export interface PanBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export class ZoomPanHandler {
  private config: ZoomConfig

  constructor(config: ZoomConfig = DEFAULT_ZOOM_CONFIG) {
    this.config = config
  }

  /**
   * Calculate zoom in, clamped to max
   */
  zoomIn(currentZoom: number): number {
    return Math.min(this.config.maxZoom, currentZoom + this.config.zoomStep)
  }

  /**
   * Calculate zoom out, clamped to min
   */
  zoomOut(currentZoom: number): number {
    return Math.max(this.config.minZoom, currentZoom - this.config.zoomStep)
  }

  /**
   * Clamp zoom to valid range
   */
  clampZoom(zoom: number): number {
    return Math.max(this.config.minZoom, Math.min(this.config.maxZoom, zoom))
  }

  /**
   * Calculate zoom level from percentage string or number
   */
  parseZoomLevel(value: string | number): number {
    if (typeof value === 'number') {
      return this.clampZoom(value)
    }
    const parsed = parseFloat(value.replace('%', '')) / 100
    return this.clampZoom(isNaN(parsed) ? 1 : parsed)
  }

  /**
   * Format zoom level as percentage string
   */
  formatZoomPercent(zoom: number): string {
    return `${Math.round(zoom * 100)}%`
  }

  /**
   * Calculate zoom to fit content in container
   * @param contentWidth - Content width in pixels
   * @param contentHeight - Content height in pixels
   * @param containerWidth - Container width in pixels
   * @param containerHeight - Container height in pixels
   * @param padding - Padding percentage (0-1)
   * @returns Zoom level to fit content
   */
  calculateFitZoom(
    contentWidth: number,
    contentHeight: number,
    containerWidth: number,
    containerHeight: number,
    padding: number = 0.1
  ): number {
    const availableWidth = containerWidth * (1 - padding * 2)
    const availableHeight = containerHeight * (1 - padding * 2)
    
    const scaleX = availableWidth / contentWidth
    const scaleY = availableHeight / contentHeight
    
    return this.clampZoom(Math.min(scaleX, scaleY))
  }

  /**
   * Calculate pan bounds based on content and container size
   * @param contentWidth - Content width at current zoom
   * @param contentHeight - Content height at current zoom
   * @param containerWidth - Container width
   * @param containerHeight - Container height
   * @returns Pan bounds { minX, maxX, minY, maxY }
   */
  calculatePanBounds(
    contentWidth: number,
    contentHeight: number,
    containerWidth: number,
    containerHeight: number
  ): PanBounds {
    const overflowX = Math.max(0, contentWidth - containerWidth)
    const overflowY = Math.max(0, contentHeight - containerHeight)
    
    return {
      minX: -overflowX / 2,
      maxX: overflowX / 2,
      minY: -overflowY / 2,
      maxY: overflowY / 2
    }
  }

  /**
   * Clamp pan position to bounds
   */
  clampPan(x: number, y: number, bounds: PanBounds): { x: number; y: number } {
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, y))
    }
  }

  /**
   * Calculate new pan position after zoom change to keep point centered
   * @param pointX - X coordinate of zoom center point
   * @param pointY - Y coordinate of zoom center point
   * @param oldZoom - Previous zoom level
   * @param newZoom - New zoom level
   * @param currentPanX - Current pan X offset
   * @param currentPanY - Current pan Y offset
   * @returns New pan position { x, y }
   */
  calculateZoomToPan(
    pointX: number,
    pointY: number,
    oldZoom: number,
    newZoom: number,
    currentPanX: number,
    currentPanY: number
  ): { x: number; y: number } {
    const zoomRatio = newZoom / oldZoom
    
    // Calculate the offset from the zoom point
    const offsetX = pointX - currentPanX
    const offsetY = pointY - currentPanY
    
    // Scale the offset by the zoom ratio
    const newOffsetX = offsetX * zoomRatio
    const newOffsetY = offsetY * zoomRatio
    
    return {
      x: pointX - newOffsetX,
      y: pointY - newOffsetY
    }
  }

  /**
   * Get zoom configuration
   */
  getConfig(): ZoomConfig {
    return { ...this.config }
  }

  /**
   * Update zoom configuration
   */
  setConfig(config: Partial<ZoomConfig>): void {
    this.config = { ...this.config, ...config }
  }
}
