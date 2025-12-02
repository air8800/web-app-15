/**
 * RecipeService
 * 
 * Generates the recipe JSON for the desktop cpdf engine.
 * The recipe contains all transforms and print settings.
 */

import {
  Recipe,
  RecipeSource,
  RecipePrint,
  RecipePage,
  PagesPerSheet
} from '../types'
import { MetadataStore } from '../state/metadataStore'
import { PageState } from './pageState'

export interface RecipeOptions {
  paperSize: string
  colorMode: string
  duplex: boolean
  copies: number
  pagesPerSheet: PagesPerSheet
  quality: string
  shopId: string | null
}

const DEFAULT_OPTIONS: RecipeOptions = {
  paperSize: 'A4',
  colorMode: 'color',
  duplex: false,
  copies: 1,
  pagesPerSheet: 1,
  quality: 'normal',
  shopId: null
}

export class RecipeService {
  private metadataStore: MetadataStore
  private pageState: PageState
  private sourceInfo: RecipeSource | null = null
  private options: RecipeOptions = { ...DEFAULT_OPTIONS }

  constructor(metadataStore: MetadataStore, pageState: PageState) {
    this.metadataStore = metadataStore
    this.pageState = pageState
  }

  /**
   * Set source file info
   */
  setSource(file: File, totalPages: number): void {
    this.sourceInfo = {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/pdf',
      totalPages
    }
  }

  /**
   * Update print options
   */
  setOptions(options: Partial<RecipeOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /**
   * Get current options
   */
  getOptions(): RecipeOptions {
    return { ...this.options }
  }

  /**
   * Generate the complete recipe
   */
  generate(): Recipe {
    if (!this.sourceInfo) {
      throw new Error('Source file info not set')
    }

    const includedPages = this.pageState.getIncluded()
    const pages: RecipePage[] = includedPages.map(pageInfo => {
      const metadata = this.metadataStore.get(pageInfo.pageNumber)
      const transforms = this.metadataStore.getTransforms(pageInfo.pageNumber)

      return {
        pageNumber: pageInfo.pageNumber,
        originalDimensions: metadata?.originalDimensions || {
          width: pageInfo.width,
          height: pageInfo.height
        },
        transforms,
        hasEdits: this.metadataStore.isEdited(pageInfo.pageNumber),
        isCropped: metadata?.isCropped || false,
        fitCropToPage: metadata?.fitCropToPage || false
      }
    })

    const print: RecipePrint = {
      paperSize: this.options.paperSize,
      colorMode: this.options.colorMode,
      duplex: this.options.duplex,
      copies: this.options.copies,
      pagesPerSheet: this.options.pagesPerSheet,
      quality: this.options.quality
    }

    return {
      version: '2.0',
      type: 'print_job',
      generatedAt: new Date().toISOString(),
      source: this.sourceInfo,
      print,
      pages,
      destination: {
        shopId: this.options.shopId
      }
    }
  }

  /**
   * Generate recipe as JSON string
   */
  toJSON(): string {
    return JSON.stringify(this.generate(), null, 2)
  }

  /**
   * Validate recipe
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!this.sourceInfo) {
      errors.push('Source file info not set')
    }

    if (this.pageState.getIncludedCount() === 0) {
      errors.push('No pages included')
    }

    // Validate transforms
    const included = this.pageState.getIncluded()
    for (const page of included) {
      const transforms = this.metadataStore.getTransforms(page.pageNumber)
      
      if (transforms.crop) {
        const { x, y, width, height } = transforms.crop
        if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
          errors.push(`Page ${page.pageNumber}: Invalid crop bounds`)
        }
      }

      if (transforms.scale < 10 || transforms.scale > 500) {
        errors.push(`Page ${page.pageNumber}: Scale out of range (10-500%)`)
      }
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * Get summary of recipe
   */
  getSummary(): {
    totalPages: number
    includedPages: number
    editedPages: number
    printSettings: string
  } {
    const included = this.pageState.getIncluded()
    const editedCount = included.filter(p => 
      this.metadataStore.isEdited(p.pageNumber)
    ).length

    return {
      totalPages: this.pageState.getTotalPages(),
      includedPages: included.length,
      editedPages: editedCount,
      printSettings: `${this.options.paperSize}, ${this.options.colorMode}, ${this.options.copies} copies`
    }
  }

  /**
   * Reset to default options
   */
  resetOptions(): void {
    this.options = { ...DEFAULT_OPTIONS }
  }
}
