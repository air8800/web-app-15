/**
 * ApplyWorkflowHandler
 * 
 * Handles state preparation and validation for apply/save workflows.
 * Extracted from PDFEditor.jsx for modularity.
 * 
 * Note: The actual save/apply operations remain in PDFEditor.jsx as they
 * are heavily DOM and React state dependent. This handler provides
 * pure utility functions for state preparation and validation.
 */

export interface EditHistory {
  rotation: number
  scale: number
  offsetX: number
  offsetY: number
  cropArea: NormalizedCropArea | null
  isCropped?: boolean
}

export interface NormalizedCropArea {
  x: number  // 0-1 normalized
  y: number  // 0-1 normalized
  width: number  // 0-1 normalized
  height: number  // 0-1 normalized
}

export interface ApplyPageState {
  pageNumber: number
  edited: boolean
  editHistory: EditHistory | null
  canvas?: HTMLCanvasElement
  width: number
  height: number
}

export interface ApplyAllSettings {
  settings: {
    rotation: number
    scale: number
    offsetX: number
    offsetY: number
  }
  userScale: number
  currentPageSize: string
  cropInfo: NormalizedCropArea | null
}

export const DEFAULT_EDIT_HISTORY: EditHistory = {
  rotation: 0,
  scale: 100,
  offsetX: 0,
  offsetY: 0,
  cropArea: null,
  isCropped: false
}

export class ApplyWorkflowHandler {
  /**
   * Check if a page has any unsaved edits
   */
  hasUnsavedEdits(page: ApplyPageState): boolean {
    if (!page.editHistory) return false
    
    const history = page.editHistory
    return (
      history.rotation !== 0 ||
      history.scale !== 100 ||
      history.offsetX !== 0 ||
      history.offsetY !== 0 ||
      history.cropArea !== null ||
      history.isCropped === true
    )
  }

  /**
   * Check if any page in a collection has unsaved edits
   */
  hasAnyUnsavedEdits(pages: ApplyPageState[]): boolean {
    return pages.some(page => this.hasUnsavedEdits(page))
  }

  /**
   * Count pages with edits
   */
  countEditedPages(pages: ApplyPageState[]): number {
    return pages.filter(page => page.edited || this.hasUnsavedEdits(page)).length
  }

  /**
   * Create a clean edit history object
   */
  createCleanEditHistory(): EditHistory {
    return { ...DEFAULT_EDIT_HISTORY }
  }

  /**
   * Merge current settings into edit history
   */
  mergeSettingsIntoHistory(
    currentHistory: EditHistory | null,
    settings: Partial<EditHistory>
  ): EditHistory {
    const base = currentHistory || this.createCleanEditHistory()
    return {
      ...base,
      ...settings
    }
  }

  /**
   * Check if settings differ from defaults (have changes)
   */
  settingsHaveChanges(settings: {
    rotation: number
    scale: number
    offsetX: number
    offsetY: number
  }): boolean {
    return (
      settings.rotation !== 0 ||
      settings.scale !== 100 ||
      settings.offsetX !== 0 ||
      settings.offsetY !== 0
    )
  }

  /**
   * Create apply-all settings object from current state
   */
  createApplyAllSettings(
    settings: { rotation: number; scale: number; offsetX: number; offsetY: number },
    userScale: number,
    currentPageSize: string,
    cropInfo: NormalizedCropArea | null
  ): ApplyAllSettings {
    return {
      settings: { ...settings },
      userScale,
      currentPageSize,
      cropInfo
    }
  }

  /**
   * Calculate progress percentage for multi-page operations
   * @param currentIndex - Current page index (0-based)
   * @param totalPages - Total number of pages
   * @param startProgress - Progress at start of operation (0-1)
   * @param endProgress - Progress at end of operation (0-1)
   */
  calculateProgress(
    currentIndex: number,
    totalPages: number,
    startProgress: number = 0,
    endProgress: number = 1
  ): number {
    if (totalPages <= 0) return endProgress
    const range = endProgress - startProgress
    return startProgress + (currentIndex / totalPages) * range
  }

  /**
   * Validate crop area dimensions
   * @param width - Crop width in pixels
   * @param height - Crop height in pixels
   * @param minSize - Minimum size threshold
   */
  validateCropSize(width: number, height: number, minSize: number = 10): boolean {
    return width >= minSize && height >= minSize
  }

  /**
   * Get list of page numbers that have edits
   */
  getEditedPageNumbers(pages: ApplyPageState[]): number[] {
    return pages
      .filter(page => page.edited || this.hasUnsavedEdits(page))
      .map(page => page.pageNumber)
  }

  /**
   * Check if two edit histories are equivalent
   */
  editHistoriesMatch(a: EditHistory | null, b: EditHistory | null): boolean {
    if (!a && !b) return true
    if (!a || !b) return false
    
    return (
      a.rotation === b.rotation &&
      a.scale === b.scale &&
      a.offsetX === b.offsetX &&
      a.offsetY === b.offsetY &&
      this.cropAreasMatch(a.cropArea, b.cropArea)
    )
  }

  /**
   * Check if two crop areas are equivalent
   */
  cropAreasMatch(a: NormalizedCropArea | null, b: NormalizedCropArea | null): boolean {
    if (!a && !b) return true
    if (!a || !b) return false
    
    const tolerance = 0.0001
    return (
      Math.abs(a.x - b.x) < tolerance &&
      Math.abs(a.y - b.y) < tolerance &&
      Math.abs(a.width - b.width) < tolerance &&
      Math.abs(a.height - b.height) < tolerance
    )
  }
}
