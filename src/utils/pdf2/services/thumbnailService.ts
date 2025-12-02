/**
 * ThumbnailService
 * 
 * Generates and caches page thumbnails.
 * Thumbnails are small preview images for the page list.
 */

import { PageTransforms } from '../types'
import { PagePreviewService } from './pagePreviewService'
import { MetadataStore } from '../state/metadataStore'

export interface ThumbnailOptions {
  maxWidth: number
  maxHeight: number
  quality: number  // 0-1
}

const DEFAULT_OPTIONS: ThumbnailOptions = {
  maxWidth: 150,
  maxHeight: 200,
  quality: 0.7
}

export class ThumbnailService {
  private previewService: PagePreviewService
  private metadataStore: MetadataStore
  private thumbnailCache: Map<string, string> = new Map()
  private maxCacheSize: number = 100

  constructor(previewService: PagePreviewService, metadataStore: MetadataStore) {
    this.previewService = previewService
    this.metadataStore = metadataStore
  }

  /**
   * Get thumbnail data URL for a page
   */
  async getThumbnail(
    pageNumber: number,
    options: Partial<ThumbnailOptions> = {}
  ): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    const transforms = this.metadataStore.getTransforms(pageNumber)
    const cacheKey = this.getCacheKey(pageNumber, transforms, opts)

    // Check cache
    if (this.thumbnailCache.has(cacheKey)) {
      return this.thumbnailCache.get(cacheKey)!
    }

    // Generate preview
    const previewCanvas = await this.previewService.getPreview(
      pageNumber,
      opts.maxWidth,
      opts.maxHeight
    )

    // Scale to thumbnail size
    const thumbnailCanvas = this.scaleToThumbnail(previewCanvas, opts)

    // Convert to data URL
    const dataUrl = thumbnailCanvas.toDataURL('image/jpeg', opts.quality)

    // Cache
    this.addToCache(cacheKey, dataUrl)

    return dataUrl
  }

  /**
   * Get cached thumbnail (if exists)
   */
  getCachedThumbnail(pageNumber: number): string | null {
    const transforms = this.metadataStore.getTransforms(pageNumber)
    const cacheKey = this.getCacheKey(pageNumber, transforms, DEFAULT_OPTIONS)
    return this.thumbnailCache.get(cacheKey) || null
  }

  /**
   * Generate all thumbnails in batch
   */
  async generateAll(
    totalPages: number,
    options: Partial<ThumbnailOptions> = {}
  ): Promise<Map<number, string>> {
    const result = new Map<number, string>()

    for (let i = 1; i <= totalPages; i++) {
      const thumbnail = await this.getThumbnail(i, options)
      result.set(i, thumbnail)
    }

    return result
  }

  /**
   * Invalidate thumbnail for a page
   */
  invalidate(pageNumber: number): void {
    const keysToDelete: string[] = []
    this.thumbnailCache.forEach((_, key) => {
      if (key.startsWith(`${pageNumber}-`)) {
        keysToDelete.push(key)
      }
    })
    keysToDelete.forEach(key => this.thumbnailCache.delete(key))
  }

  /**
   * Invalidate all thumbnails
   */
  invalidateAll(): void {
    this.thumbnailCache.clear()
  }

  /**
   * Scale canvas to fit thumbnail dimensions
   */
  private scaleToThumbnail(
    source: HTMLCanvasElement,
    options: ThumbnailOptions
  ): HTMLCanvasElement {
    const scaleX = options.maxWidth / source.width
    const scaleY = options.maxHeight / source.height
    const scale = Math.min(scaleX, scaleY, 1) // Don't upscale

    const result = document.createElement('canvas')
    result.width = source.width * scale
    result.height = source.height * scale

    const ctx = result.getContext('2d')
    if (ctx) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'medium'
      ctx.drawImage(source, 0, 0, result.width, result.height)
    }

    return result
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    pageNumber: number,
    transforms: PageTransforms,
    options: ThumbnailOptions
  ): string {
    return `${pageNumber}-${JSON.stringify(transforms)}-${options.maxWidth}x${options.maxHeight}`
  }

  /**
   * Add to cache with LRU eviction
   */
  private addToCache(key: string, dataUrl: string): void {
    if (this.thumbnailCache.size >= this.maxCacheSize) {
      const firstKey = this.thumbnailCache.keys().next().value
      if (firstKey) {
        this.thumbnailCache.delete(firstKey)
      }
    }
    this.thumbnailCache.set(key, dataUrl)
  }
}
