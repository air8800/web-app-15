/**
 * ModernAdapter
 * 
 * Implements PdfController using the new pdf2 services.
 * This is the modern, modular implementation.
 */

import {
  PdfController,
  EditCommand,
  Recipe,
  PageMetadata,
  ProgressCallback
} from '../types'
import { MetadataStore } from '../state/metadataStore'
import { EditOrchestrator } from '../edits/editOrchestrator'
import { ProgressBus } from '../services/progressBus'
import { PageState } from '../services/pageState'
import { SelectionState } from '../services/selectionState'
import { DocumentLoader, LoadResult } from '../services/documentLoader'
import { PagePreviewService } from '../services/pagePreviewService'
import { ThumbnailService } from '../services/thumbnailService'
import { RecipeService } from '../services/recipeService'
import { GridService } from '../services/gridService'
import { UIStateManager } from '../ui/uiState'
import { CanvasInteraction } from '../ui/canvasInteraction'

export interface ModernAdapterOptions {
  containerWidth?: number
  containerHeight?: number
  thumbnailSize?: number
}

const DEFAULT_OPTIONS: ModernAdapterOptions = {
  containerWidth: 800,
  containerHeight: 600,
  thumbnailSize: 150
}

export class ModernAdapter implements PdfController {
  // Core services
  private metadataStore: MetadataStore
  private progressBus: ProgressBus
  private pageState: PageState
  private selectionState: SelectionState
  private documentLoader: DocumentLoader
  private pagePreviewService: PagePreviewService
  private thumbnailService: ThumbnailService
  private recipeService: RecipeService
  private gridService: GridService
  private editOrchestrator: EditOrchestrator
  private uiState: UIStateManager
  private canvasInteraction: CanvasInteraction

  // State
  private currentFile: File | null = null
  private options: ModernAdapterOptions
  private isInitialized: boolean = false
  private previewCache: Map<number, HTMLCanvasElement> = new Map()
  private pendingRenders: Map<number, Promise<HTMLCanvasElement>> = new Map()
  private pageVersions: Map<number, number> = new Map()  // Version tracking for cache invalidation

  constructor(options: ModernAdapterOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }

    // Initialize services in dependency order
    this.metadataStore = new MetadataStore()
    this.progressBus = new ProgressBus()
    this.pageState = new PageState()
    this.selectionState = new SelectionState()
    this.documentLoader = new DocumentLoader(this.progressBus, this.metadataStore)
    this.pagePreviewService = new PagePreviewService(
      this.documentLoader,
      this.metadataStore,
      this.progressBus
    )
    this.thumbnailService = new ThumbnailService(
      this.pagePreviewService,
      this.metadataStore
    )
    this.recipeService = new RecipeService(this.metadataStore, this.pageState)
    this.gridService = new GridService(this.pagePreviewService, this.pageState)
    this.editOrchestrator = new EditOrchestrator(this.metadataStore)
    this.uiState = new UIStateManager()
    this.canvasInteraction = new CanvasInteraction()
  }

  /**
   * Load PDF document
   */
  async loadDocument(file: File): Promise<void> {
    console.log(`📥 [ModernAdapter] loadDocument START - file: ${file.name}, size: ${(file.size / 1024 / 1024).toFixed(2)}MB`)
    this.currentFile = file
    this.uiState.startLoading('parsing')

    try {
      const result: LoadResult = await this.documentLoader.loadFile(file)
      console.log(`📥 [ModernAdapter] Document loaded - ${result.totalPages} pages, docId: ${result.documentId}`)

      // Initialize page state
      this.pageState.init(result.pages, result.documentId)

      // Set source for recipe
      this.recipeService.setSource(file, result.totalPages)

      // Pre-render first page preview immediately
      this.isInitialized = true
      console.log(`📥 [ModernAdapter] Generating first page preview...`)
      await this.ensurePreview(1)
      console.log(`📥 [ModernAdapter] First page preview complete`)

      // Generate remaining previews and thumbnails in background
      this.generatePreviewsAsync(result.totalPages)
      this.generateThumbnailsAsync()

      this.uiState.finishLoading()
      console.log(`📥 [ModernAdapter] loadDocument COMPLETE`)
    } catch (error) {
      console.error(`📥 [ModernAdapter] loadDocument FAILED:`, error)
      const message = error instanceof Error ? error.message : 'Failed to load PDF'
      this.uiState.setError(message)
      throw error
    }
  }

  /**
   * Get page preview canvas from cache
   * Returns cached preview if available, or triggers async render and returns null
   * For guaranteed canvas, use ensurePreview() or getPagePreviewAsync()
   */
  getPagePreview(pageNum: number): HTMLCanvasElement | null {
    if (!this.isInitialized) return null
    
    const cached = this.previewCache.get(pageNum)
    if (cached) return cached

    // Trigger render in background if not already pending
    if (!this.pendingRenders.has(pageNum)) {
      this.triggerPreviewRender(pageNum)
    }

    return null
  }

  /**
   * Get current version for a page
   */
  private getPageVersion(pageNum: number): number {
    return this.pageVersions.get(pageNum) || 0
  }

  /**
   * Increment version for a page (called on invalidation)
   */
  private incrementPageVersion(pageNum: number): void {
    this.pageVersions.set(pageNum, this.getPageVersion(pageNum) + 1)
  }

  /**
   * Trigger preview render in background
   */
  private triggerPreviewRender(pageNum: number): void {
    const versionAtStart = this.getPageVersion(pageNum)

    const renderPromise = this.pagePreviewService.getPreview(
      pageNum,
      this.options.containerWidth!,
      this.options.containerHeight!
    ).then(canvas => {
      // Only write to cache if version hasn't changed (no invalidation occurred)
      if (this.getPageVersion(pageNum) === versionAtStart) {
        this.previewCache.set(pageNum, canvas)
      }
      this.pendingRenders.delete(pageNum)
      return canvas
    }).catch(e => {
      this.pendingRenders.delete(pageNum)
      throw e
    })

    this.pendingRenders.set(pageNum, renderPromise)
  }

  /**
   * Ensure preview exists (renders if needed) and returns it
   * This is the guaranteed async way to get a preview
   */
  async ensurePreview(pageNum: number): Promise<HTMLCanvasElement> {
    console.log(`🖼️ [ModernAdapter] ensurePreview(${pageNum}) START`)
    
    // Check cache first
    const cached = this.previewCache.get(pageNum)
    if (cached) {
      console.log(`🖼️ [ModernAdapter] ensurePreview(${pageNum}) - CACHE HIT, size: ${cached.width}x${cached.height}`)
      return cached
    }

    // Check if already rendering
    const pending = this.pendingRenders.get(pageNum)
    if (pending) {
      console.log(`🖼️ [ModernAdapter] ensurePreview(${pageNum}) - PENDING, waiting...`)
      return pending
    }

    // Capture version at render start
    const versionAtStart = this.getPageVersion(pageNum)
    console.log(`🖼️ [ModernAdapter] ensurePreview(${pageNum}) - RENDERING (version: ${versionAtStart})...`)

    // Start new render
    const renderPromise = this.pagePreviewService.getPreview(
      pageNum,
      this.options.containerWidth!,
      this.options.containerHeight!
    ).then(canvas => {
      // Only write to cache if version hasn't changed (no invalidation occurred)
      if (this.getPageVersion(pageNum) === versionAtStart) {
        this.previewCache.set(pageNum, canvas)
        console.log(`🖼️ [ModernAdapter] ensurePreview(${pageNum}) - CACHED, size: ${canvas.width}x${canvas.height}`)
      } else {
        console.log(`🖼️ [ModernAdapter] ensurePreview(${pageNum}) - VERSION CHANGED, not caching`)
      }
      this.pendingRenders.delete(pageNum)
      return canvas
    }).catch(e => {
      console.error(`🖼️ [ModernAdapter] ensurePreview(${pageNum}) - FAILED:`, e)
      this.pendingRenders.delete(pageNum)
      throw e
    })

    this.pendingRenders.set(pageNum, renderPromise)
    return renderPromise
  }

  /**
   * Wait for a specific page preview to be ready
   */
  async waitForPreview(pageNum: number): Promise<HTMLCanvasElement> {
    return this.ensurePreview(pageNum)
  }

  /**
   * Get page preview (async version)
   */
  async getPagePreviewAsync(
    pageNum: number,
    width: number,
    height: number
  ): Promise<HTMLCanvasElement> {
    console.log(`🎨 [ModernAdapter] getPagePreviewAsync(${pageNum}, ${width}x${height}) START`)
    try {
      const canvas = await this.pagePreviewService.getPreview(pageNum, width, height)
      console.log(`🎨 [ModernAdapter] getPagePreviewAsync(${pageNum}) - SUCCESS, canvas: ${canvas.width}x${canvas.height}`)
      return canvas
    } catch (e) {
      console.error(`🎨 [ModernAdapter] getPagePreviewAsync(${pageNum}) - FAILED:`, e)
      throw e
    }
  }

  /**
   * Apply edit to page
   */
  applyEdit(pageNum: number, edit: EditCommand): void {
    this.editOrchestrator.applyEdit(pageNum, edit)

    // Invalidate all caches for this page
    this.incrementPageVersion(pageNum)  // Prevents stale renders from writing to cache
    this.previewCache.delete(pageNum)
    this.pendingRenders.delete(pageNum)
    this.pagePreviewService.clearPageCache(pageNum)
    this.thumbnailService.invalidate(pageNum)
    this.gridService.invalidateSheetsForPage(pageNum)
  }

  /**
   * Get thumbnail
   */
  getThumbnail(pageNum: number): string | null {
    return this.thumbnailService.getCachedThumbnail(pageNum)
  }

  /**
   * Get thumbnail (async version)
   */
  async getThumbnailAsync(pageNum: number): Promise<string> {
    console.log(`📷 [ModernAdapter] getThumbnailAsync(${pageNum}) START`)
    try {
      const thumbnail = await this.thumbnailService.getThumbnail(pageNum, {
        maxWidth: this.options.thumbnailSize,
        maxHeight: this.options.thumbnailSize! * 1.4 // ~A4 ratio
      })
      console.log(`📷 [ModernAdapter] getThumbnailAsync(${pageNum}) - SUCCESS, dataURL length: ${thumbnail.length}`)
      return thumbnail
    } catch (e) {
      console.error(`📷 [ModernAdapter] getThumbnailAsync(${pageNum}) - FAILED:`, e)
      throw e
    }
  }

  /**
   * Export recipe for desktop cpdf
   */
  exportRecipe(): Recipe {
    return this.recipeService.generate()
  }

  /**
   * Subscribe to progress events
   */
  onProgress(callback: ProgressCallback): () => void {
    return this.progressBus.on('*', event => {
      callback(event.progress || 0, event.type)
    })
  }

  /**
   * Get page count
   */
  getPageCount(): number {
    return this.pageState.getTotalPages()
  }

  /**
   * Get page metadata
   */
  getPageMetadata(pageNum: number): PageMetadata | null {
    return this.metadataStore.get(pageNum)
  }

  /**
   * Reset page
   */
  resetPage(pageNum: number): void {
    this.editOrchestrator.resetPage(pageNum)
    this.incrementPageVersion(pageNum)  // Prevents stale renders from writing to cache
    this.previewCache.delete(pageNum)
    this.pendingRenders.delete(pageNum)
    this.pagePreviewService.clearPageCache(pageNum)
    this.thumbnailService.invalidate(pageNum)
    this.gridService.invalidateSheetsForPage(pageNum)
  }

  /**
   * Reset all pages
   */
  resetAll(): void {
    this.editOrchestrator.resetAll()
    
    // Increment version for ALL pages (not just those with entries)
    // This invalidates any in-flight renders started before this reset
    const totalPages = this.pageState.getTotalPages()
    for (let i = 1; i <= totalPages; i++) {
      this.incrementPageVersion(i)
    }
    
    this.previewCache.clear()
    this.pendingRenders.clear()
    this.pagePreviewService.clearCache()
    this.thumbnailService.invalidateAll()
    this.gridService.clearCache()
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.documentLoader.destroy()
    this.pageVersions.clear()
    this.previewCache.clear()
    this.pendingRenders.clear()
    this.pagePreviewService.clearCache()
    this.thumbnailService.invalidateAll()
    this.gridService.clearCache()
    this.progressBus.clear()
    this.uiState.reset()
    this.currentFile = null
    this.isInitialized = false
  }

  // ============================================
  // ADDITIONAL PUBLIC METHODS
  // ============================================

  /**
   * Get services for direct access (advanced use)
   */
  getServices() {
    return {
      metadataStore: this.metadataStore,
      progressBus: this.progressBus,
      pageState: this.pageState,
      selectionState: this.selectionState,
      documentLoader: this.documentLoader,
      pagePreviewService: this.pagePreviewService,
      thumbnailService: this.thumbnailService,
      recipeService: this.recipeService,
      gridService: this.gridService,
      editOrchestrator: this.editOrchestrator,
      uiState: this.uiState,
      canvasInteraction: this.canvasInteraction
    }
  }

  /**
   * Get edit orchestrator
   */
  getEditOrchestrator(): EditOrchestrator {
    return this.editOrchestrator
  }

  /**
   * Get UI state manager
   */
  getUIState(): UIStateManager {
    return this.uiState
  }

  /**
   * Get page state
   */
  getPageState(): PageState {
    return this.pageState
  }

  /**
   * Get selection state
   */
  getSelectionState(): SelectionState {
    return this.selectionState
  }

  /**
   * Check if loaded
   */
  isLoaded(): boolean {
    return this.isInitialized
  }

  /**
   * Get current file
   */
  getCurrentFile(): File | null {
    return this.currentFile
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /**
   * Generate previews in background (starting from page 2)
   */
  private async generatePreviewsAsync(totalPages: number): Promise<void> {
    for (let i = 2; i <= totalPages; i++) {
      try {
        await this.ensurePreview(i)
      } catch (e) {
        console.warn(`[ModernAdapter] Failed to generate preview for page ${i}:`, e)
      }
    }
  }

  /**
   * Generate thumbnails in background
   */
  private async generateThumbnailsAsync(): Promise<void> {
    const totalPages = this.pageState.getTotalPages()
    
    for (let i = 1; i <= totalPages; i++) {
      try {
        await this.thumbnailService.getThumbnail(i)
      } catch (e) {
        console.warn(`[ModernAdapter] Failed to generate thumbnail for page ${i}:`, e)
      }
    }
  }
}
