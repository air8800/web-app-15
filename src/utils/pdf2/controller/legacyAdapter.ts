/**
 * LegacyAdapter
 * 
 * Wraps the old PDFEditor.jsx functionality to conform to the new PdfController interface.
 * This allows gradual migration - the feature flag can switch between legacy and modern.
 * 
 * The legacy code lives in:
 * - src/components/PDFEditor.jsx (4,871 lines)
 * - src/utils/pdf/* (various utilities)
 */

import {
  PdfController,
  EditCommand,
  Recipe,
  PageMetadata,
  ProgressCallback,
  DEFAULT_TRANSFORMS
} from '../types'

/**
 * Reference to legacy PDFEditor component instance
 * This is populated by the React component that wraps it
 */
export interface LegacyPdfEditorRef {
  exportPDF: () => Promise<void>
  clearAllEdits: () => void
  
  // Additional methods we need to expose from the legacy component
  pages?: Array<{
    pageNumber: number
    width: number
    height: number
    canvas: HTMLCanvasElement | null
    thumbnail: string | null
    editHistory?: {
      crop: { x: number; y: number; width: number; height: number } | null
      rotation: number
      scale: number
      offsetX: number
      offsetY: number
    }
  }>
}

export class LegacyAdapter implements PdfController {
  private ref: LegacyPdfEditorRef | null = null
  private progressCallbacks: Set<ProgressCallback> = new Set()
  private currentFile: File | null = null

  /**
   * Set the legacy component ref
   */
  setRef(ref: LegacyPdfEditorRef): void {
    this.ref = ref
  }

  /**
   * Load PDF document
   * In legacy mode, this is handled by the PDFEditor component internally
   */
  async loadDocument(file: File): Promise<void> {
    this.currentFile = file
    this.notifyProgress(0, 'parsing')
    
    // The legacy component handles loading internally
    // This adapter just stores the file reference
    // The actual loading is triggered by passing the file as a prop
    
    this.notifyProgress(100, 'loading')
  }

  /**
   * Get page preview canvas
   */
  getPagePreview(pageNum: number): HTMLCanvasElement | null {
    if (!this.ref?.pages) return null
    
    const page = this.ref.pages.find(p => p.pageNumber === pageNum)
    return page?.canvas || null
  }

  /**
   * Apply edit to page
   * In legacy mode, edits are handled by the PDFEditor component
   */
  applyEdit(pageNum: number, edit: EditCommand): void {
    // Legacy mode: edits are applied through React state in PDFEditor
    // This is a no-op in the adapter; actual edits happen in the component
    console.log('[LegacyAdapter] applyEdit called', pageNum, edit.type)
  }

  /**
   * Get thumbnail
   */
  getThumbnail(pageNum: number): string | null {
    if (!this.ref?.pages) return null
    
    const page = this.ref.pages.find(p => p.pageNumber === pageNum)
    return page?.thumbnail || null
  }

  /**
   * Export recipe for desktop cpdf
   */
  exportRecipe(): Recipe {
    if (!this.currentFile) {
      throw new Error('No file loaded')
    }

    const pages = this.ref?.pages || []
    
    return {
      version: '1.0', // Legacy version
      type: 'print_job',
      generatedAt: new Date().toISOString(),
      source: {
        fileName: this.currentFile.name,
        fileSize: this.currentFile.size,
        fileType: this.currentFile.type || 'application/pdf',
        totalPages: pages.length
      },
      print: {
        paperSize: 'A4',
        colorMode: 'color',
        duplex: false,
        copies: 1,
        pagesPerSheet: 1,
        quality: 'normal'
      },
      pages: pages.map(page => ({
        pageNumber: page.pageNumber,
        originalDimensions: { width: page.width, height: page.height },
        transforms: page.editHistory ? {
          crop: page.editHistory.crop,
          rotation: (page.editHistory.rotation as 0 | 90 | 180 | 270) || 0,
          scale: page.editHistory.scale || 100,
          offsetX: page.editHistory.offsetX || 0,
          offsetY: page.editHistory.offsetY || 0
        } : { ...DEFAULT_TRANSFORMS },
        hasEdits: !!(page.editHistory?.crop || page.editHistory?.rotation),
        isCropped: !!page.editHistory?.crop,
        fitCropToPage: false
      })),
      destination: {
        shopId: null
      }
    }
  }

  /**
   * Subscribe to progress events
   */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback)
    return () => this.progressCallbacks.delete(callback)
  }

  /**
   * Get page count
   */
  getPageCount(): number {
    return this.ref?.pages?.length || 0
  }

  /**
   * Get page metadata
   */
  getPageMetadata(pageNum: number): PageMetadata | null {
    if (!this.ref?.pages) return null
    
    const page = this.ref.pages.find(p => p.pageNumber === pageNum)
    if (!page) return null

    return {
      pageNumber: page.pageNumber,
      originalDimensions: { width: page.width, height: page.height },
      transforms: page.editHistory ? {
        crop: page.editHistory.crop,
        rotation: (page.editHistory.rotation as 0 | 90 | 180 | 270) || 0,
        scale: page.editHistory.scale || 100,
        offsetX: page.editHistory.offsetX || 0,
        offsetY: page.editHistory.offsetY || 0
      } : { ...DEFAULT_TRANSFORMS },
      edited: !!(page.editHistory?.crop || page.editHistory?.rotation),
      isCropped: !!page.editHistory?.crop,
      fitCropToPage: false
    }
  }

  /**
   * Reset page
   */
  resetPage(pageNum: number): void {
    // Legacy: would need to call into PDFEditor's reset logic
    console.log('[LegacyAdapter] resetPage called', pageNum)
  }

  /**
   * Reset all pages
   */
  resetAll(): void {
    if (this.ref?.clearAllEdits) {
      this.ref.clearAllEdits()
    }
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.ref = null
    this.progressCallbacks.clear()
    this.currentFile = null
  }

  /**
   * Notify progress callbacks
   */
  private notifyProgress(progress: number, stage?: string): void {
    this.progressCallbacks.forEach(callback => {
      try {
        callback(progress, stage)
      } catch (e) {
        console.error('[LegacyAdapter] Progress callback error:', e)
      }
    })
  }

  /**
   * Get the current file
   */
  getCurrentFile(): File | null {
    return this.currentFile
  }
}
