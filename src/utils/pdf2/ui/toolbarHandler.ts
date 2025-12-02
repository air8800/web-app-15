/**
 * ToolbarHandler
 * 
 * Handles toolbar actions for the PDF editor.
 * Extracted from PDFEditor.jsx for modularity.
 * 
 * Maps to old functions: applyAllChanges, finalizeSave, performFinalizeSave, resetSettings
 */

import { CropBox, RotationDegrees, EditCommand } from '../types'

export type ApplyScope = 'current' | 'all' | 'selected'

export interface PendingEdits {
  crop: CropBox | null
  rotation: RotationDegrees
  fitCropToPage: boolean
}

export interface ToolbarState {
  pendingEdits: PendingEdits
  hasUnsavedChanges: boolean
  isApplying: boolean
  showUnsavedPopup: boolean
}

export interface ApplyResult {
  success: boolean
  editsApplied: EditCommand[]
  error?: string
}

export type UnsavedAction = 'save' | 'discard' | 'cancel'

export class ToolbarHandler {
  private state: ToolbarState = {
    pendingEdits: {
      crop: null,
      rotation: 0,
      fitCropToPage: false
    },
    hasUnsavedChanges: false,
    isApplying: false,
    showUnsavedPopup: false
  }

  private listeners: Set<(state: ToolbarState) => void> = new Set()

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: ToolbarState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    const stateCopy = { ...this.state }
    this.listeners.forEach(listener => listener(stateCopy))
  }

  /**
   * Get current state
   */
  getState(): ToolbarState {
    return { ...this.state }
  }

  /**
   * Initialize for a page
   */
  initialize(existingEdits?: Partial<PendingEdits>): void {
    this.state = {
      pendingEdits: {
        crop: existingEdits?.crop ?? null,
        rotation: existingEdits?.rotation ?? 0,
        fitCropToPage: existingEdits?.fitCropToPage ?? false
      },
      hasUnsavedChanges: false,
      isApplying: false,
      showUnsavedPopup: false
    }
    this.notifyListeners()
  }

  /**
   * Set pending crop
   */
  setCrop(crop: CropBox | null): void {
    this.state = {
      ...this.state,
      pendingEdits: {
        ...this.state.pendingEdits,
        crop: crop ? { ...crop } : null
      },
      hasUnsavedChanges: true
    }
    this.notifyListeners()
  }

  /**
   * Set pending rotation
   */
  setRotation(rotation: RotationDegrees): void {
    this.state = {
      ...this.state,
      pendingEdits: {
        ...this.state.pendingEdits,
        rotation
      },
      hasUnsavedChanges: true
    }
    this.notifyListeners()
  }

  /**
   * Set fit crop to page
   */
  setFitCropToPage(fit: boolean): void {
    this.state = {
      ...this.state,
      pendingEdits: {
        ...this.state.pendingEdits,
        fitCropToPage: fit
      },
      hasUnsavedChanges: true
    }
    this.notifyListeners()
  }

  /**
   * Get pending edits
   */
  getPendingEdits(): PendingEdits {
    return {
      crop: this.state.pendingEdits.crop ? { ...this.state.pendingEdits.crop } : null,
      rotation: this.state.pendingEdits.rotation,
      fitCropToPage: this.state.pendingEdits.fitCropToPage
    }
  }

  /**
   * Check if there are unsaved changes
   */
  hasUnsavedChanges(): boolean {
    return this.state.hasUnsavedChanges
  }

  /**
   * Build edit commands from pending edits
   * Maps to: buildEditCommands (internal to applyAllChanges)
   */
  buildEditCommands(): EditCommand[] {
    const commands: EditCommand[] = []
    const { crop, rotation } = this.state.pendingEdits

    if (crop) {
      commands.push({ type: 'crop', value: crop })
    }

    if (rotation !== 0) {
      commands.push({ type: 'rotate', value: rotation === 180 ? 180 : (rotation === 90 ? 90 : -90) })
    }

    return commands
  }

  /**
   * Mark as applying (show loading state)
   */
  startApplying(): void {
    this.state = {
      ...this.state,
      isApplying: true
    }
    this.notifyListeners()
  }

  /**
   * Mark apply complete
   */
  finishApplying(success: boolean): void {
    this.state = {
      ...this.state,
      isApplying: false,
      hasUnsavedChanges: success ? false : this.state.hasUnsavedChanges
    }
    this.notifyListeners()
  }

  /**
   * Show unsaved changes popup
   * Maps to: showing the "Unsaved Changes" modal
   */
  showUnsavedPopup(): void {
    this.state = {
      ...this.state,
      showUnsavedPopup: true
    }
    this.notifyListeners()
  }

  /**
   * Hide unsaved changes popup
   */
  hideUnsavedPopup(): void {
    this.state = {
      ...this.state,
      showUnsavedPopup: false
    }
    this.notifyListeners()
  }

  /**
   * Handle unsaved popup action
   * Maps to: handling Save & Close / Discard Changes buttons
   */
  handleUnsavedAction(action: UnsavedAction): { shouldClose: boolean; shouldSave: boolean } {
    this.hideUnsavedPopup()

    switch (action) {
      case 'save':
        return { shouldClose: true, shouldSave: true }
      case 'discard':
        return { shouldClose: true, shouldSave: false }
      case 'cancel':
      default:
        return { shouldClose: false, shouldSave: false }
    }
  }

  /**
   * Reset all pending edits
   * Maps to: resetSettings()
   */
  resetEdits(): void {
    this.state = {
      ...this.state,
      pendingEdits: {
        crop: null,
        rotation: 0,
        fitCropToPage: false
      },
      hasUnsavedChanges: false
    }
    this.notifyListeners()
  }

  /**
   * Clear crop only
   */
  clearCrop(): void {
    this.state = {
      ...this.state,
      pendingEdits: {
        ...this.state.pendingEdits,
        crop: null
      }
    }
    this.notifyListeners()
  }

  /**
   * Check if applying is in progress
   */
  isApplying(): boolean {
    return this.state.isApplying
  }

  /**
   * Check if unsaved popup is visible
   */
  isUnsavedPopupVisible(): boolean {
    return this.state.showUnsavedPopup
  }

  /**
   * Mark edits as saved (after successful apply)
   */
  markAsSaved(): void {
    this.state = {
      ...this.state,
      hasUnsavedChanges: false
    }
    this.notifyListeners()
  }
}
