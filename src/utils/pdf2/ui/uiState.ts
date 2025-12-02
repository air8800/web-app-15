/**
 * UIState
 * 
 * Manages UI-related state for the PDF editor.
 * Tracks modal visibility, edit mode, loading states, etc.
 */

import { UIState as UIStateType, CropBox } from '../types'

export type LoadingStage = 'parsing' | 'loading' | 'ready' | null

export type EditorTab = 'page' | 'crop' | 'rotation'

export type PaperSize = 'A4' | 'A5' | 'Letter' | 'Legal' | 'B5'

export interface EditorSettings {
  activeTab: EditorTab
  paperSize: PaperSize
  colorMode: 'color' | 'bw'
  fitCropToPage: boolean
  rotation: number
  pendingCrop: CropBox | null
  hasUnsavedChanges: boolean
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  activeTab: 'page',
  paperSize: 'A4',
  colorMode: 'color',
  fitCropToPage: false,
  rotation: 0,
  pendingCrop: null,
  hasUnsavedChanges: false
}

export class UIStateManager {
  private state: UIStateType = {
    showEditPopup: false,
    editingPageIndex: -1,
    editingPageNumber: -1,
    cropMode: false,
    isDragging: false,
    isLoading: false,
    loadingStage: null,
    error: null,
    zoom: 100,
    showGrid: false
  }

  private editorSettings: EditorSettings = { ...DEFAULT_EDITOR_SETTINGS }

  private listeners: Set<(state: UIStateType) => void> = new Set()

  /**
   * Get current state (copy)
   */
  getState(): UIStateType {
    return { ...this.state }
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: UIStateType) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Update state and notify listeners
   */
  private update(partial: Partial<UIStateType>): void {
    this.state = { ...this.state, ...partial }
    this.notifyListeners()
  }

  private notifyListeners(): void {
    const stateCopy = { ...this.state }
    this.listeners.forEach(listener => listener(stateCopy))
  }

  // ============================================
  // EDIT POPUP
  // ============================================

  openEditPopup(pageIndex: number, pageNumber: number): void {
    this.update({
      showEditPopup: true,
      editingPageIndex: pageIndex,
      editingPageNumber: pageNumber
    })
  }

  closeEditPopup(): void {
    this.update({
      showEditPopup: false,
      editingPageIndex: -1,
      editingPageNumber: -1,
      cropMode: false
    })
  }

  isEditPopupOpen(): boolean {
    return this.state.showEditPopup
  }

  getEditingPage(): { index: number; number: number } {
    return {
      index: this.state.editingPageIndex,
      number: this.state.editingPageNumber
    }
  }

  // ============================================
  // CROP MODE
  // ============================================

  enterCropMode(): void {
    this.update({ cropMode: true })
  }

  exitCropMode(): void {
    this.update({ cropMode: false })
  }

  toggleCropMode(): void {
    this.update({ cropMode: !this.state.cropMode })
  }

  isInCropMode(): boolean {
    return this.state.cropMode
  }

  // ============================================
  // DRAGGING
  // ============================================

  setDragging(isDragging: boolean): void {
    this.update({ isDragging })
  }

  isDragging(): boolean {
    return this.state.isDragging
  }

  // ============================================
  // LOADING
  // ============================================

  setLoading(isLoading: boolean, stage: LoadingStage = null): void {
    this.update({ isLoading, loadingStage: stage })
  }

  startLoading(stage: LoadingStage): void {
    this.update({ isLoading: true, loadingStage: stage, error: null })
  }

  finishLoading(): void {
    this.update({ isLoading: false, loadingStage: 'ready' })
  }

  isLoading(): boolean {
    return this.state.isLoading
  }

  getLoadingStage(): LoadingStage {
    return this.state.loadingStage
  }

  // ============================================
  // ERROR
  // ============================================

  setError(error: string | null): void {
    this.update({ error, isLoading: false })
  }

  clearError(): void {
    this.update({ error: null })
  }

  getError(): string | null {
    return this.state.error
  }

  hasError(): boolean {
    return this.state.error !== null
  }

  // ============================================
  // ZOOM
  // ============================================

  setZoom(zoom: number): void {
    this.update({ zoom: Math.max(25, Math.min(400, zoom)) })
  }

  zoomIn(): void {
    this.setZoom(this.state.zoom + 10)
  }

  zoomOut(): void {
    this.setZoom(this.state.zoom - 10)
  }

  resetZoom(): void {
    this.setZoom(100)
  }

  getZoom(): number {
    return this.state.zoom
  }

  // ============================================
  // GRID VIEW
  // ============================================

  setShowGrid(show: boolean): void {
    this.update({ showGrid: show })
  }

  toggleGrid(): void {
    this.update({ showGrid: !this.state.showGrid })
  }

  isGridVisible(): boolean {
    return this.state.showGrid
  }

  // ============================================
  // RESET
  // ============================================

  reset(): void {
    this.state = {
      showEditPopup: false,
      editingPageIndex: -1,
      editingPageNumber: -1,
      cropMode: false,
      isDragging: false,
      isLoading: false,
      loadingStage: null,
      error: null,
      zoom: 100,
      showGrid: false
    }
    this.editorSettings = { ...DEFAULT_EDITOR_SETTINGS }
    this.notifyListeners()
  }

  // ============================================
  // EDITOR SETTINGS
  // ============================================

  getEditorSettings(): EditorSettings {
    return { ...this.editorSettings }
  }

  setActiveTab(tab: EditorTab): void {
    this.editorSettings = { ...this.editorSettings, activeTab: tab }
    if (tab === 'crop') {
      this.update({ cropMode: true })
    } else {
      this.update({ cropMode: false })
    }
  }

  getActiveTab(): EditorTab {
    return this.editorSettings.activeTab
  }

  setPaperSize(size: PaperSize): void {
    this.editorSettings = { ...this.editorSettings, paperSize: size, hasUnsavedChanges: true }
    this.notifyListeners()
  }

  getPaperSize(): PaperSize {
    return this.editorSettings.paperSize
  }

  setColorMode(mode: 'color' | 'bw'): void {
    this.editorSettings = { ...this.editorSettings, colorMode: mode, hasUnsavedChanges: true }
    this.notifyListeners()
  }

  getColorMode(): 'color' | 'bw' {
    return this.editorSettings.colorMode
  }

  setFitCropToPage(fit: boolean): void {
    this.editorSettings = { ...this.editorSettings, fitCropToPage: fit, hasUnsavedChanges: true }
    this.notifyListeners()
  }

  getFitCropToPage(): boolean {
    return this.editorSettings.fitCropToPage
  }

  setRotation(degrees: number): void {
    const normalized = ((degrees % 360) + 360) % 360
    this.editorSettings = { ...this.editorSettings, rotation: normalized, hasUnsavedChanges: true }
    this.notifyListeners()
  }

  getRotation(): number {
    return this.editorSettings.rotation
  }

  setPendingCrop(crop: CropBox | null): void {
    this.editorSettings = { 
      ...this.editorSettings, 
      pendingCrop: crop ? { ...crop } : null,
      hasUnsavedChanges: crop !== null || this.editorSettings.hasUnsavedChanges
    }
    this.notifyListeners()
  }

  getPendingCrop(): CropBox | null {
    return this.editorSettings.pendingCrop ? { ...this.editorSettings.pendingCrop } : null
  }

  setHasUnsavedChanges(has: boolean): void {
    this.editorSettings = { ...this.editorSettings, hasUnsavedChanges: has }
    this.notifyListeners()
  }

  hasUnsavedChanges(): boolean {
    return this.editorSettings.hasUnsavedChanges
  }

  resetEditorSettings(): void {
    this.editorSettings = { ...DEFAULT_EDITOR_SETTINGS }
    this.notifyListeners()
  }

  // ============================================
  // EDITOR LIFECYCLE
  // ============================================

  initializeForPage(pageNumber: number, existingRotation: number = 0): void {
    this.editorSettings = {
      ...DEFAULT_EDITOR_SETTINGS,
      rotation: existingRotation
    }
    this.notifyListeners()
  }

  markAsSaved(): void {
    this.editorSettings = { ...this.editorSettings, hasUnsavedChanges: false }
    this.notifyListeners()
  }
}
