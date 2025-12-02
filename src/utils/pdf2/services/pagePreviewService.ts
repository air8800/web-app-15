/**
 * PagePreviewService
 * 
 * Renders page previews with transforms applied.
 * Handles the visual preview for the canvas display.
 */

import { PageTransforms } from '../types'
import { DocumentLoader } from './documentLoader'
import { MetadataStore } from '../state/metadataStore'
import { ProgressBus } from './progressBus'

export class PagePreviewService {
  private documentLoader: DocumentLoader
  private metadataStore: MetadataStore
  private progressBus: ProgressBus
  private previewCache: Map<string, HTMLCanvasElement> = new Map()
  private maxCacheSize: number = 20

  constructor(
    documentLoader: DocumentLoader,
    metadataStore: MetadataStore,
    progressBus: ProgressBus
  ) {
    this.documentLoader = documentLoader
    this.metadataStore = metadataStore
    this.progressBus = progressBus
  }

  /**
   * Get preview canvas for a page with transforms applied
   */
  async getPreview(
    pageNumber: number,
    containerWidth: number,
    containerHeight: number
  ): Promise<HTMLCanvasElement> {
    console.log(`🔍 [PagePreviewService] getPreview(${pageNumber}, ${containerWidth}x${containerHeight}) START`)
    const transforms = this.metadataStore.getTransforms(pageNumber)
    const cacheKey = this.getCacheKey(pageNumber, transforms, containerWidth, containerHeight)

    // Check cache
    if (this.previewCache.has(cacheKey)) {
      const cached = this.previewCache.get(cacheKey)!
      console.log(`🔍 [PagePreviewService] getPreview(${pageNumber}) - CACHE HIT, size: ${cached.width}x${cached.height}`)
      return cached
    }

    this.progressBus.emitRenderStart(pageNumber)

    // Render base page
    console.log(`🔍 [PagePreviewService] getPreview(${pageNumber}) - Rendering base page...`)
    const baseCanvas = document.createElement('canvas')
    const scale = this.calculateScale(pageNumber, containerWidth, containerHeight)
    console.log(`🔍 [PagePreviewService] getPreview(${pageNumber}) - Scale: ${scale}`)
    await this.documentLoader.renderPageToCanvas(pageNumber, baseCanvas, scale)
    console.log(`🔍 [PagePreviewService] getPreview(${pageNumber}) - Base canvas: ${baseCanvas.width}x${baseCanvas.height}`)

    // Apply transforms
    const transformedCanvas = this.applyTransforms(baseCanvas, transforms)
    console.log(`🔍 [PagePreviewService] getPreview(${pageNumber}) - Transformed canvas: ${transformedCanvas.width}x${transformedCanvas.height}`)

    // Cache result
    this.addToCache(cacheKey, transformedCanvas)

    this.progressBus.emitRenderComplete(pageNumber)
    console.log(`🔍 [PagePreviewService] getPreview(${pageNumber}) COMPLETE`)
    return transformedCanvas
  }

  /**
   * Apply all transforms to a canvas
   */
  private applyTransforms(source: HTMLCanvasElement, transforms: PageTransforms): HTMLCanvasElement {
    let current = source

    // Apply transforms in order: CROP → ROTATE → SCALE
    if (transforms.crop) {
      current = this.applyCrop(current, transforms.crop)
    }

    if (transforms.rotation !== 0) {
      current = this.applyRotation(current, transforms.rotation)
    }

    if (transforms.scale !== 100) {
      current = this.applyScale(current, transforms.scale)
    }

    return current
  }

  /**
   * Apply crop to canvas
   */
  private applyCrop(
    source: HTMLCanvasElement,
    crop: { x: number; y: number; width: number; height: number }
  ): HTMLCanvasElement {
    const result = document.createElement('canvas')
    const sx = crop.x * source.width
    const sy = crop.y * source.height
    const sw = crop.width * source.width
    const sh = crop.height * source.height

    result.width = sw
    result.height = sh

    const ctx = result.getContext('2d')
    if (ctx) {
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
    }

    return result
  }

  /**
   * Apply rotation to canvas
   */
  private applyRotation(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
    const result = document.createElement('canvas')
    const ctx = result.getContext('2d')
    if (!ctx) return source

    const radians = (degrees * Math.PI) / 180

    if (degrees === 90 || degrees === 270) {
      result.width = source.height
      result.height = source.width
    } else {
      result.width = source.width
      result.height = source.height
    }

    ctx.translate(result.width / 2, result.height / 2)
    ctx.rotate(radians)
    ctx.drawImage(source, -source.width / 2, -source.height / 2)

    return result
  }

  /**
   * Apply scale to canvas
   */
  private applyScale(source: HTMLCanvasElement, scalePercent: number): HTMLCanvasElement {
    const result = document.createElement('canvas')
    const scale = scalePercent / 100

    result.width = source.width * scale
    result.height = source.height * scale

    const ctx = result.getContext('2d')
    if (ctx) {
      ctx.drawImage(source, 0, 0, result.width, result.height)
    }

    return result
  }

  /**
   * Calculate scale to fit in container
   */
  private calculateScale(
    pageNumber: number,
    containerWidth: number,
    containerHeight: number
  ): number {
    const dimensions = this.documentLoader.getPageDimensions(pageNumber)
    if (!dimensions) return 1

    const scaleX = containerWidth / dimensions.width
    const scaleY = containerHeight / dimensions.height
    return Math.min(scaleX, scaleY, 2) // Cap at 2x for performance
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    pageNumber: number,
    transforms: PageTransforms,
    width: number,
    height: number
  ): string {
    return JSON.stringify({
      page: pageNumber,
      transforms,
      width: Math.round(width),
      height: Math.round(height)
    })
  }

  /**
   * Add to cache with LRU eviction
   */
  private addToCache(key: string, canvas: HTMLCanvasElement): void {
    if (this.previewCache.size >= this.maxCacheSize) {
      const firstKey = this.previewCache.keys().next().value
      if (firstKey) {
        this.previewCache.delete(firstKey)
      }
    }
    this.previewCache.set(key, canvas)
  }

  /**
   * Clear cache for a specific page
   */
  clearPageCache(pageNumber: number): void {
    const keysToDelete: string[] = []
    this.previewCache.forEach((_, key) => {
      if (key.includes(`"page":${pageNumber}`)) {
        keysToDelete.push(key)
      }
    })
    keysToDelete.forEach(key => this.previewCache.delete(key))
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.previewCache.clear()
  }

  /**
   * Get raw page canvas without transforms
   */
  async getRawPreview(
    pageNumber: number,
    scale: number = 1
  ): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas')
    await this.documentLoader.renderPageToCanvas(pageNumber, canvas, scale)
    return canvas
  }
}
