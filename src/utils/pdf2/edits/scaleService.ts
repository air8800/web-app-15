/**
 * ScaleService
 * 
 * Handles all scale-related operations.
 * Scale is the THIRD operation in transform order: CROP → ROTATE → SCALE → TRANSLATE
 * 
 * Scale is stored as percentage (100 = 100% = original size)
 * Valid range: 10% to 500%
 */

import { MetadataStore } from '../state/metadataStore'

export class ScaleService {
  private store: MetadataStore
  
  // Scale limits
  static readonly MIN_SCALE = 10    // 10%
  static readonly MAX_SCALE = 500   // 500%
  static readonly DEFAULT_SCALE = 100  // 100%

  constructor(store: MetadataStore) {
    this.store = store
  }

  /**
   * Get current scale for a page
   */
  getScale(pageNumber: number): number {
    return this.store.getScale(pageNumber)
  }

  /**
   * Set absolute scale for a page
   */
  setScale(pageNumber: number, scale: number): number {
    const clamped = this.clampScale(scale)
    this.store.setScale(pageNumber, clamped)
    return clamped
  }

  /**
   * Add delta to current scale
   */
  adjustScale(pageNumber: number, delta: number): number {
    const current = this.getScale(pageNumber)
    return this.setScale(pageNumber, current + delta)
  }

  /**
   * Multiply current scale by factor
   */
  multiplyScale(pageNumber: number, factor: number): number {
    const current = this.getScale(pageNumber)
    return this.setScale(pageNumber, current * factor)
  }

  /**
   * Zoom in by 10%
   */
  zoomIn(pageNumber: number): number {
    return this.adjustScale(pageNumber, 10)
  }

  /**
   * Zoom out by 10%
   */
  zoomOut(pageNumber: number): number {
    return this.adjustScale(pageNumber, -10)
  }

  /**
   * Reset scale to 100%
   */
  resetScale(pageNumber: number): void {
    this.store.setScale(pageNumber, ScaleService.DEFAULT_SCALE)
  }

  /**
   * Clamp scale to valid range
   */
  clampScale(scale: number): number {
    return Math.max(ScaleService.MIN_SCALE, Math.min(ScaleService.MAX_SCALE, scale))
  }

  /**
   * Validate scale value
   */
  isValidScale(scale: number): boolean {
    return scale >= ScaleService.MIN_SCALE && scale <= ScaleService.MAX_SCALE
  }

  /**
   * Get scale as decimal (100% = 1.0)
   */
  getScaleDecimal(pageNumber: number): number {
    return this.getScale(pageNumber) / 100
  }

  /**
   * Set scale from decimal (1.0 = 100%)
   */
  setScaleFromDecimal(pageNumber: number, decimal: number): number {
    return this.setScale(pageNumber, decimal * 100)
  }

  /**
   * Get CSS transform string for scale
   */
  getCSSScale(pageNumber: number): string {
    const decimal = this.getScaleDecimal(pageNumber)
    return `scale(${decimal})`
  }

  /**
   * Calculate scaled dimensions
   */
  getScaledDimensions(
    pageNumber: number,
    originalWidth: number,
    originalHeight: number
  ): { width: number; height: number } {
    const scale = this.getScaleDecimal(pageNumber)
    return {
      width: originalWidth * scale,
      height: originalHeight * scale
    }
  }

  /**
   * Calculate scale to fit within target dimensions
   */
  calculateFitScale(
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    mode: 'contain' | 'cover' = 'contain'
  ): number {
    const scaleX = targetWidth / sourceWidth
    const scaleY = targetHeight / sourceHeight
    
    const scale = mode === 'contain'
      ? Math.min(scaleX, scaleY)
      : Math.max(scaleX, scaleY)
    
    return this.clampScale(scale * 100)
  }

  /**
   * Check if page is scaled (not at 100%)
   */
  isScaled(pageNumber: number): boolean {
    return this.getScale(pageNumber) !== ScaleService.DEFAULT_SCALE
  }

  /**
   * Get scale percentage formatted as string
   */
  getScaleString(pageNumber: number): string {
    return `${this.getScale(pageNumber)}%`
  }
}
