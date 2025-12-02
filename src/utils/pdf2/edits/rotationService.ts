/**
 * RotationService
 * 
 * Handles all rotation-related operations.
 * Rotation is the SECOND operation in transform order: CROP → ROTATE → SCALE → TRANSLATE
 * 
 * Only supports 0°, 90°, 180°, 270° rotations.
 * When rotation changes, existing crop must be remapped.
 */

import { RotationDegrees } from '../types'
import { MetadataStore } from '../state/metadataStore'
import { CropService } from './cropService'

export class RotationService {
  private store: MetadataStore
  private cropService: CropService

  constructor(store: MetadataStore, cropService: CropService) {
    this.store = store
    this.cropService = cropService
  }

  /**
   * Get current rotation for a page
   */
  getRotation(pageNumber: number): RotationDegrees {
    return this.store.getRotation(pageNumber)
  }

  /**
   * Set absolute rotation for a page
   * Remaps existing crop if present
   */
  setRotation(pageNumber: number, rotation: RotationDegrees): void {
    const currentRotation = this.store.getRotation(pageNumber)
    
    if (currentRotation === rotation) return

    // Remap crop if exists
    this.remapCropForRotationChange(pageNumber, currentRotation, rotation)

    this.store.setRotation(pageNumber, rotation)
  }

  /**
   * Add delta rotation (90, -90, 180)
   * Returns new rotation value
   */
  rotate(pageNumber: number, delta: 90 | -90 | 180): RotationDegrees {
    const currentRotation = this.store.getRotation(pageNumber)
    const newRotation = this.calculateNewRotation(currentRotation, delta)

    // Remap crop if exists
    this.remapCropForRotationChange(pageNumber, currentRotation, newRotation)

    this.store.setRotation(pageNumber, newRotation)
    return newRotation
  }

  /**
   * Rotate clockwise by 90°
   */
  rotateClockwise(pageNumber: number): RotationDegrees {
    return this.rotate(pageNumber, 90)
  }

  /**
   * Rotate counter-clockwise by 90°
   */
  rotateCounterClockwise(pageNumber: number): RotationDegrees {
    return this.rotate(pageNumber, -90)
  }

  /**
   * Rotate by 180°
   */
  rotate180(pageNumber: number): RotationDegrees {
    return this.rotate(pageNumber, 180)
  }

  /**
   * Reset rotation to 0°
   */
  resetRotation(pageNumber: number): void {
    const currentRotation = this.store.getRotation(pageNumber)
    
    if (currentRotation === 0) return

    // Remap crop back to original orientation
    this.remapCropForRotationChange(pageNumber, currentRotation, 0)

    this.store.setRotation(pageNumber, 0)
  }

  /**
   * Calculate new rotation from current + delta
   */
  private calculateNewRotation(current: RotationDegrees, delta: number): RotationDegrees {
    const newValue = ((current + delta) % 360 + 360) % 360
    return this.normalizeRotation(newValue)
  }

  /**
   * Normalize any rotation value to valid RotationDegrees
   */
  normalizeRotation(degrees: number): RotationDegrees {
    const normalized = ((degrees % 360) + 360) % 360
    
    // Snap to nearest 90°
    if (normalized < 45) return 0
    if (normalized < 135) return 90
    if (normalized < 225) return 180
    if (normalized < 315) return 270
    return 0
  }

  /**
   * Check if rotation swaps dimensions (90° or 270°)
   */
  isRotationSwapped(rotation: RotationDegrees): boolean {
    return rotation === 90 || rotation === 270
  }

  /**
   * Get rotated dimensions
   */
  getRotatedDimensions(
    originalWidth: number,
    originalHeight: number,
    rotation: RotationDegrees
  ): { width: number; height: number } {
    if (this.isRotationSwapped(rotation)) {
      return { width: originalHeight, height: originalWidth }
    }
    return { width: originalWidth, height: originalHeight }
  }

  /**
   * Remap existing crop when rotation changes
   * Uses cropService.setCrop to ensure normalization and validation
   */
  private remapCropForRotationChange(
    pageNumber: number,
    fromRotation: RotationDegrees,
    toRotation: RotationDegrees
  ): void {
    const currentCrop = this.cropService.getCrop(pageNumber)
    if (!currentCrop) return

    const remappedCrop = this.cropService.remapCropForRotation(
      currentCrop,
      fromRotation,
      toRotation
    )

    // Use cropService.setCrop to ensure normalization and validation
    this.cropService.setCrop(pageNumber, remappedCrop)
  }

  /**
   * Get CSS transform string for rotation
   */
  getCSSRotation(pageNumber: number): string {
    const rotation = this.getRotation(pageNumber)
    return `rotate(${rotation}deg)`
  }

  /**
   * Get rotation in radians
   */
  getRotationRadians(pageNumber: number): number {
    const degrees = this.getRotation(pageNumber)
    return (degrees * Math.PI) / 180
  }

  /**
   * Check if page is rotated (not at 0°)
   */
  isRotated(pageNumber: number): boolean {
    return this.getRotation(pageNumber) !== 0
  }

  /**
   * Check if page is in landscape orientation after rotation
   */
  isLandscapeAfterRotation(
    pageNumber: number,
    originalWidth: number,
    originalHeight: number
  ): boolean {
    const rotation = this.getRotation(pageNumber)
    const { width, height } = this.getRotatedDimensions(originalWidth, originalHeight, rotation)
    return width > height
  }
}
