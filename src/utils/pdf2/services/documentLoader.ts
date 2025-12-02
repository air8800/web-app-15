/**
 * DocumentLoader
 * 
 * Handles PDF document loading using pdf.js.
 * Extracts page info, renders initial previews and thumbnails.
 */

import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { PageInfo, PageDimensions } from '../types'
import { ProgressBus } from './progressBus'
import { MetadataStore } from '../state/metadataStore'

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

export interface LoadResult {
  documentId: string
  pages: PageInfo[]
  totalPages: number
}

export class DocumentLoader {
  private progressBus: ProgressBus
  private metadataStore: MetadataStore
  private pdfDoc: PDFDocumentProxy | null = null
  private pageProxies: Map<number, PDFPageProxy> = new Map()
  private renderLocks: Map<number, Promise<void>> = new Map()  // Prevent concurrent renders

  constructor(progressBus: ProgressBus, metadataStore: MetadataStore) {
    this.progressBus = progressBus
    this.metadataStore = metadataStore
  }

  /**
   * Load PDF from File
   */
  async loadFile(file: File): Promise<LoadResult> {
    this.progressBus.emitLoadStart()

    try {
      const arrayBuffer = await file.arrayBuffer()
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: 'https://unpkg.com/pdfjs-dist/cmaps/',
        cMapPacked: true
      })

      this.pdfDoc = await loadingTask.promise
      const totalPages = this.pdfDoc.numPages
      const documentId = this.generateDocumentId(file)

      this.progressBus.emitLoadProgress(10, 1, totalPages)

      // Load all pages and extract info
      const pages: PageInfo[] = []
      for (let i = 1; i <= totalPages; i++) {
        const page = await this.pdfDoc.getPage(i)
        this.pageProxies.set(i, page)

        const viewport = page.getViewport({ scale: 1 })
        const dimensions: PageDimensions = {
          width: viewport.width,
          height: viewport.height
        }

        // Initialize metadata store
        this.metadataStore.initPage(i, dimensions)

        pages.push({
          pageNumber: i,
          width: viewport.width,
          height: viewport.height,
          thumbnail: null  // Will be generated later
        })

        const progress = 10 + (i / totalPages) * 80
        this.progressBus.emitLoadProgress(progress, i, totalPages)
      }

      this.progressBus.emitLoadComplete(totalPages)

      return {
        documentId,
        pages,
        totalPages
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.progressBus.emitLoadError(err)
      throw err
    }
  }

  /**
   * Get a page proxy for rendering
   */
  getPageProxy(pageNumber: number): PDFPageProxy | null {
    return this.pageProxies.get(pageNumber) || null
  }

  /**
   * Get PDF document
   */
  getDocument(): PDFDocumentProxy | null {
    return this.pdfDoc
  }

  /**
   * Render page to canvas at given scale
   * Uses render lock to prevent concurrent renders on the same page (pdf.js limitation)
   */
  async renderPageToCanvas(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number = 1
  ): Promise<void> {
    console.log(`📄 [DocumentLoader] renderPageToCanvas(${pageNumber}, scale=${scale}) START`)
    
    const page = this.pageProxies.get(pageNumber)
    if (!page) {
      throw new Error(`Page ${pageNumber} not loaded`)
    }

    // Wait for any previous render on this page to complete
    const existingLock = this.renderLocks.get(pageNumber)
    if (existingLock) {
      console.log(`📄 [DocumentLoader] renderPageToCanvas(${pageNumber}) - Waiting for previous render...`)
      await existingLock
    }

    // Create render promise with lock
    const renderPromise = (async () => {
      const viewport = page.getViewport({ scale })
      canvas.width = viewport.width
      canvas.height = viewport.height
      console.log(`📄 [DocumentLoader] renderPageToCanvas(${pageNumber}) - Canvas: ${canvas.width}x${canvas.height}`)

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Failed to get canvas context')
      }

      await page.render({
        canvasContext: ctx,
        viewport
      }).promise
      
      console.log(`📄 [DocumentLoader] renderPageToCanvas(${pageNumber}) COMPLETE`)
    })()

    // Store the lock
    this.renderLocks.set(pageNumber, renderPromise)

    try {
      await renderPromise
    } finally {
      // Clean up lock after render completes
      if (this.renderLocks.get(pageNumber) === renderPromise) {
        this.renderLocks.delete(pageNumber)
      }
    }
  }

  /**
   * Render page at specific dimensions
   */
  async renderPageAtSize(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    targetWidth: number,
    targetHeight: number
  ): Promise<void> {
    const page = this.pageProxies.get(pageNumber)
    if (!page) {
      throw new Error(`Page ${pageNumber} not loaded`)
    }

    const originalViewport = page.getViewport({ scale: 1 })
    const scaleX = targetWidth / originalViewport.width
    const scaleY = targetHeight / originalViewport.height
    const scale = Math.min(scaleX, scaleY)

    await this.renderPageToCanvas(pageNumber, canvas, scale)
  }

  /**
   * Get page dimensions at original scale
   */
  getPageDimensions(pageNumber: number): PageDimensions | null {
    const page = this.pageProxies.get(pageNumber)
    if (!page) return null

    const viewport = page.getViewport({ scale: 1 })
    return {
      width: viewport.width,
      height: viewport.height
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.pageProxies.clear()
    if (this.pdfDoc) {
      this.pdfDoc.destroy()
      this.pdfDoc = null
    }
  }

  /**
   * Check if loaded
   */
  isLoaded(): boolean {
    return this.pdfDoc !== null
  }

  /**
   * Get total pages
   */
  getTotalPages(): number {
    return this.pdfDoc?.numPages || 0
  }

  /**
   * Generate unique document ID
   */
  private generateDocumentId(file: File): string {
    return `${file.name}-${file.size}-${file.lastModified}`
  }
}
