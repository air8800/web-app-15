/**
 * EditOrchestrator
 * 
 * Combines all edit services and ensures correct transform order:
 * CROP → ROTATE → SCALE → TRANSLATE
 * 
 * This is the single entry point for all edit operations.
 * It dispatches to the appropriate service and maintains consistency.
 */

import {
  EditCommand,
  CropBox,
  PageTransforms,
  RotationDegrees
} from '../types'
import { MetadataStore } from '../state/metadataStore'
import { CropService } from './cropService'
import { RotationService } from './rotationService'
import { ScaleService } from './scaleService'

export class EditOrchestrator {
  private store: MetadataStore
  private cropService: CropService
  private rotationService: RotationService
  private scaleService: ScaleService

  constructor(store: MetadataStore) {
    this.store = store
    this.cropService = new CropService(store)
    this.rotationService = new RotationService(store, this.cropService)
    this.scaleService = new ScaleService(store)
  }

  /**
   * Apply an edit command to a page
   */
  applyEdit(pageNumber: number, command: EditCommand): PageTransforms {
    switch (command.type) {
      case 'crop':
        this.cropService.setCrop(pageNumber, command.value as CropBox)
        break

      case 'rotate':
        const delta = command.value as 90 | -90 | 180
        this.rotationService.rotate(pageNumber, delta)
        break

      case 'scale':
        this.scaleService.setScale(pageNumber, command.value as number)
        break

      case 'translate':
        const { dx, dy } = command.value as { dx: number; dy: number }
        this.store.addOffset(pageNumber, dx, dy)
        break

      case 'reset':
        this.store.resetPage(pageNumber)
        break

      default:
        console.warn(`[EditOrchestrator] Unknown edit type:`, command)
    }

    return this.getTransforms(pageNumber)
  }

  /**
   * Get current transforms for a page
   */
  getTransforms(pageNumber: number): PageTransforms {
    return this.store.getTransforms(pageNumber)
  }

  /**
   * Apply multiple edits in sequence
   */
  applyEdits(pageNumber: number, commands: EditCommand[]): PageTransforms {
    for (const command of commands) {
      this.applyEdit(pageNumber, command)
    }
    return this.getTransforms(pageNumber)
  }

  // ============================================
  // CONVENIENCE METHODS
  // ============================================

  /**
   * Set crop
   */
  setCrop(pageNumber: number, crop: CropBox): boolean {
    return this.cropService.setCrop(pageNumber, crop)
  }

  /**
   * Clear crop
   */
  clearCrop(pageNumber: number): void {
    this.cropService.clearCrop(pageNumber)
  }

  /**
   * Rotate clockwise
   */
  rotateClockwise(pageNumber: number): RotationDegrees {
    return this.rotationService.rotateClockwise(pageNumber)
  }

  /**
   * Rotate counter-clockwise
   */
  rotateCounterClockwise(pageNumber: number): RotationDegrees {
    return this.rotationService.rotateCounterClockwise(pageNumber)
  }

  /**
   * Set scale
   */
  setScale(pageNumber: number, scale: number): number {
    return this.scaleService.setScale(pageNumber, scale)
  }

  /**
   * Set offset
   */
  setOffset(pageNumber: number, offsetX: number, offsetY: number): void {
    this.store.setOffset(pageNumber, offsetX, offsetY)
  }

  /**
   * Reset page to original state
   */
  resetPage(pageNumber: number): void {
    this.store.resetPage(pageNumber)
  }

  /**
   * Reset all pages
   */
  resetAll(): void {
    this.store.resetAll()
  }

  /**
   * Apply current page transforms to all pages
   */
  applyToAll(sourcePageNumber: number): void {
    this.store.applyToAll(sourcePageNumber)
  }

  // ============================================
  // SERVICE ACCESSORS
  // ============================================

  getCropService(): CropService {
    return this.cropService
  }

  getRotationService(): RotationService {
    return this.rotationService
  }

  getScaleService(): ScaleService {
    return this.scaleService
  }

  // ============================================
  // STATE QUERIES
  // ============================================

  /**
   * Check if page has any edits
   */
  hasEdits(pageNumber: number): boolean {
    return this.store.isEdited(pageNumber)
  }

  /**
   * Check if any page has edits
   */
  hasAnyEdits(): boolean {
    return this.store.hasAnyEdits()
  }

  /**
   * Get combined CSS transform string
   * Order: rotate then scale (crop is applied to source, not CSS)
   */
  getCSSTransform(pageNumber: number): string {
    const rotation = this.rotationService.getCSSRotation(pageNumber)
    const scale = this.scaleService.getCSSScale(pageNumber)
    return `${rotation} ${scale}`
  }

  /**
   * Check if page dimensions are swapped due to rotation
   */
  areDimensionsSwapped(pageNumber: number): boolean {
    return this.rotationService.isRotationSwapped(
      this.rotationService.getRotation(pageNumber)
    )
  }

  /**
   * Get effective dimensions after rotation
   */
  getEffectiveDimensions(
    pageNumber: number,
    originalWidth: number,
    originalHeight: number
  ): { width: number; height: number } {
    const rotation = this.rotationService.getRotation(pageNumber)
    return this.rotationService.getRotatedDimensions(originalWidth, originalHeight, rotation)
  }
}
