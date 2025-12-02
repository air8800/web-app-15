/**
 * MetadataStore
 * 
 * Core data structure for storing per-page metadata.
 * Stores transforms in the correct order: CROP → ROTATE → SCALE → TRANSLATE
 */

import {
  PageMetadata,
  PageTransforms,
  PageDimensions,
  CropBox,
  RotationDegrees,
  DEFAULT_TRANSFORMS
} from '../types'

export class MetadataStore {
  private metadata: Map<number, PageMetadata> = new Map()
  private originalDimensions: Map<number, PageDimensions> = new Map()

  /**
   * Initialize metadata for a page
   */
  initPage(pageNumber: number, dimensions: PageDimensions): void {
    this.originalDimensions.set(pageNumber, { ...dimensions })
    
    if (!this.metadata.has(pageNumber)) {
      this.metadata.set(pageNumber, {
        pageNumber,
        originalDimensions: { ...dimensions },
        transforms: { ...DEFAULT_TRANSFORMS },
        edited: false,
        isCropped: false,
        fitCropToPage: false
      })
    }
  }

  /**
   * Get metadata for a page
   */
  get(pageNumber: number): PageMetadata | null {
    return this.metadata.get(pageNumber) || null
  }

  /**
   * Get transforms for a page (deep clone to prevent mutation)
   */
  getTransforms(pageNumber: number): PageTransforms {
    const meta = this.metadata.get(pageNumber)
    if (!meta) return { ...DEFAULT_TRANSFORMS }
    
    // Deep clone to prevent external mutation of store state
    return {
      crop: meta.transforms.crop ? { ...meta.transforms.crop } : null,
      rotation: meta.transforms.rotation,
      scale: meta.transforms.scale,
      offsetX: meta.transforms.offsetX,
      offsetY: meta.transforms.offsetY
    }
  }

  /**
   * Get original dimensions for a page
   */
  getOriginalDimensions(pageNumber: number): PageDimensions | null {
    return this.originalDimensions.get(pageNumber) || null
  }

  // ============================================
  // CROP OPERATIONS
  // ============================================

  setCrop(pageNumber: number, crop: CropBox): void {
    const meta = this.metadata.get(pageNumber)
    if (!meta) return

    meta.transforms.crop = { ...crop }
    meta.isCropped = true
    meta.edited = true
  }

  getCrop(pageNumber: number): CropBox | null {
    const meta = this.metadata.get(pageNumber)
    return meta?.transforms.crop || null
  }

  clearCrop(pageNumber: number): void {
    const meta = this.metadata.get(pageNumber)
    if (!meta) return

    meta.transforms.crop = null
    meta.isCropped = false
    this.updateEditedFlag(pageNumber)
  }

  // ============================================
  // ROTATION OPERATIONS
  // ============================================

  setRotation(pageNumber: number, rotation: RotationDegrees): void {
    const meta = this.metadata.get(pageNumber)
    if (!meta) return

    meta.transforms.rotation = rotation
    meta.edited = true
  }

  getRotation(pageNumber: number): RotationDegrees {
    const meta = this.metadata.get(pageNumber)
    return meta?.transforms.rotation || 0
  }

  addRotation(pageNumber: number, delta: number): RotationDegrees {
    const current = this.getRotation(pageNumber)
    const newRotation = ((current + delta) % 360 + 360) % 360 as RotationDegrees
    this.setRotation(pageNumber, newRotation)
    return newRotation
  }

  // ============================================
  // SCALE OPERATIONS
  // ============================================

  setScale(pageNumber: number, scale: number): void {
    const meta = this.metadata.get(pageNumber)
    if (!meta) return

    // Clamp scale between 10% and 500%
    const clampedScale = Math.max(10, Math.min(500, scale))
    meta.transforms.scale = clampedScale
    meta.edited = true
  }

  getScale(pageNumber: number): number {
    const meta = this.metadata.get(pageNumber)
    return meta?.transforms.scale || 100
  }

  // ============================================
  // TRANSLATE (OFFSET) OPERATIONS
  // ============================================

  setOffset(pageNumber: number, offsetX: number, offsetY: number): void {
    const meta = this.metadata.get(pageNumber)
    if (!meta) return

    meta.transforms.offsetX = offsetX
    meta.transforms.offsetY = offsetY
    meta.edited = true
  }

  getOffset(pageNumber: number): { offsetX: number; offsetY: number } {
    const meta = this.metadata.get(pageNumber)
    return {
      offsetX: meta?.transforms.offsetX || 0,
      offsetY: meta?.transforms.offsetY || 0
    }
  }

  addOffset(pageNumber: number, dx: number, dy: number): void {
    const current = this.getOffset(pageNumber)
    this.setOffset(pageNumber, current.offsetX + dx, current.offsetY + dy)
  }

  // ============================================
  // FIT CROP TO PAGE
  // ============================================

  setFitCropToPage(pageNumber: number, fit: boolean): void {
    const meta = this.metadata.get(pageNumber)
    if (!meta) return

    meta.fitCropToPage = fit
  }

  getFitCropToPage(pageNumber: number): boolean {
    const meta = this.metadata.get(pageNumber)
    return meta?.fitCropToPage || false
  }

  // ============================================
  // RESET OPERATIONS
  // ============================================

  resetPage(pageNumber: number): void {
    const meta = this.metadata.get(pageNumber)
    if (!meta) return

    const originalDims = this.originalDimensions.get(pageNumber)
    
    this.metadata.set(pageNumber, {
      pageNumber,
      originalDimensions: originalDims ? { ...originalDims } : meta.originalDimensions,
      transforms: { ...DEFAULT_TRANSFORMS },
      edited: false,
      isCropped: false,
      fitCropToPage: false
    })
  }

  resetAll(): void {
    for (const pageNumber of this.metadata.keys()) {
      this.resetPage(pageNumber)
    }
  }

  // ============================================
  // UTILITY OPERATIONS
  // ============================================

  private updateEditedFlag(pageNumber: number): void {
    const meta = this.metadata.get(pageNumber)
    if (!meta) return

    const t = meta.transforms
    meta.edited = !!(
      t.crop ||
      t.rotation !== 0 ||
      t.scale !== 100 ||
      t.offsetX !== 0 ||
      t.offsetY !== 0
    )
  }

  isEdited(pageNumber: number): boolean {
    const meta = this.metadata.get(pageNumber)
    return meta?.edited || false
  }

  hasAnyEdits(): boolean {
    for (const meta of this.metadata.values()) {
      if (meta.edited) return true
    }
    return false
  }

  getPageCount(): number {
    return this.metadata.size
  }

  getAllMetadata(): PageMetadata[] {
    return Array.from(this.metadata.values()).sort((a, b) => a.pageNumber - b.pageNumber)
  }

  clear(): void {
    this.metadata.clear()
    this.originalDimensions.clear()
  }

  /**
   * Clone transforms from one page to another
   */
  cloneTransforms(fromPage: number, toPage: number): void {
    const source = this.metadata.get(fromPage)
    const target = this.metadata.get(toPage)
    
    if (!source || !target) return

    target.transforms = { ...source.transforms }
    if (source.transforms.crop) {
      target.transforms.crop = { ...source.transforms.crop }
    }
    target.edited = source.edited
    target.isCropped = source.isCropped
    target.fitCropToPage = source.fitCropToPage
  }

  /**
   * Apply same transforms to all pages
   */
  applyToAll(sourcePageNumber: number): void {
    const source = this.metadata.get(sourcePageNumber)
    if (!source) return

    for (const pageNumber of this.metadata.keys()) {
      if (pageNumber !== sourcePageNumber) {
        this.cloneTransforms(sourcePageNumber, pageNumber)
      }
    }
  }
}

// Singleton instance for global use
let instance: MetadataStore | null = null

export function getMetadataStore(): MetadataStore {
  if (!instance) {
    instance = new MetadataStore()
  }
  return instance
}

export function resetMetadataStore(): void {
  if (instance) {
    instance.clear()
  }
  instance = null
}
