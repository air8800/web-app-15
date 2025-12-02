/**
 * PDF2 Types
 * 
 * All TypeScript interfaces for the new PDF editor module.
 * Transform order: CROP → ROTATE → SCALE → TRANSLATE
 */

// ============================================
// CROP TYPES
// ============================================

export interface CropBox {
  x: number       // 0-1 normalized (left edge)
  y: number       // 0-1 normalized (top edge)
  width: number   // 0-1 normalized
  height: number  // 0-1 normalized
}

// ============================================
// TRANSFORM TYPES
// ============================================

export type RotationDegrees = 0 | 90 | 180 | 270

export interface PageTransforms {
  crop: CropBox | null
  rotation: RotationDegrees
  scale: number      // percentage (100 = 100%)
  offsetX: number    // pixels
  offsetY: number    // pixels
}

export const DEFAULT_TRANSFORMS: PageTransforms = {
  crop: null,
  rotation: 0,
  scale: 100,
  offsetX: 0,
  offsetY: 0
}

// ============================================
// PAGE STATE TYPES
// ============================================

export interface PageDimensions {
  width: number   // PDF points (72 points = 1 inch)
  height: number  // PDF points
}

export interface PageInfo {
  pageNumber: number
  width: number
  height: number
  thumbnail: string | null
}

export interface PageMetadata {
  pageNumber: number
  originalDimensions: PageDimensions
  transforms: PageTransforms
  edited: boolean
  isCropped: boolean
  fitCropToPage: boolean
}

export interface PageData {
  pageNumber: number
  width: number
  height: number
  canvas: HTMLCanvasElement | null
  thumbnail: string | null
  originalCanvas: HTMLCanvasElement | null
  pristineOriginal: HTMLCanvasElement | null
  isLoading: boolean
  editHistory: PageTransforms
  edited: boolean
}

// ============================================
// EDIT COMMAND TYPES
// ============================================

export type EditType = 'crop' | 'rotate' | 'scale' | 'translate' | 'reset'

export interface CropCommand {
  type: 'crop'
  value: CropBox
}

export interface RotateCommand {
  type: 'rotate'
  value: 90 | -90 | 180  // delta rotation
}

export interface ScaleCommand {
  type: 'scale'
  value: number  // percentage
}

export interface TranslateCommand {
  type: 'translate'
  value: { dx: number; dy: number }
}

export interface ResetCommand {
  type: 'reset'
}

export type EditCommand = CropCommand | RotateCommand | ScaleCommand | TranslateCommand | ResetCommand

// ============================================
// RECIPE TYPES (for desktop cpdf)
// ============================================

export interface RecipeSource {
  fileName: string
  fileSize: number
  fileType: string
  totalPages: number
}

export interface RecipePrint {
  paperSize: string
  colorMode: string
  duplex: boolean
  copies: number
  pagesPerSheet: number
  quality: string
}

export interface RecipePage {
  pageNumber: number
  originalDimensions: PageDimensions
  transforms: PageTransforms
  hasEdits: boolean
  isCropped: boolean
  fitCropToPage: boolean
}

export interface Recipe {
  version: string
  type: string
  generatedAt: string
  source: RecipeSource
  print: RecipePrint
  pages: RecipePage[]
  destination: {
    shopId: string | null
  }
}

// ============================================
// CONTROLLER INTERFACE (6 methods)
// ============================================

export type ProgressCallback = (progress: number, stage?: string) => void

export interface PdfControllerOptions {
  paperSize?: string
  colorMode?: string
  pagesPerSheet?: number
  shopId?: string
}

export interface PdfController {
  // 1. Load PDF document
  loadDocument(file: File): Promise<void>
  
  // 2. Get page preview canvas
  getPagePreview(pageNum: number): HTMLCanvasElement | null
  
  // 3. Apply edit to page
  applyEdit(pageNum: number, edit: EditCommand): void
  
  // 4. Get thumbnail
  getThumbnail(pageNum: number): string | null
  
  // 5. Export recipe for desktop cpdf
  exportRecipe(): Recipe
  
  // 6. Progress callback
  onProgress(callback: ProgressCallback): () => void
  
  // Additional helpers
  getPageCount(): number
  getPageMetadata(pageNum: number): PageMetadata | null
  resetPage(pageNum: number): void
  resetAll(): void
  destroy(): void
}

// ============================================
// UI STATE TYPES
// ============================================

export interface UIState {
  showEditPopup: boolean
  editingPageIndex: number
  editingPageNumber: number
  cropMode: boolean
  isDragging: boolean
  isLoading: boolean
  loadingStage: 'parsing' | 'loading' | 'ready' | null
  error: string | null
  zoom: number
  showGrid: boolean
}

// ============================================
// CANVAS INTERACTION TYPES
// ============================================

export type DragHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'move'

export interface DragState {
  isDragging: boolean
  handle: DragHandle | null
  startX: number
  startY: number
  startCrop: CropBox | null
}

export interface ImageRect {
  left: number
  top: number
  width: number
  height: number
}

// ============================================
// GRID / N-UP TYPES
// ============================================

export type PagesPerSheet = 1 | 2 | 4

export interface GridSheet {
  sheetNumber: number
  pages: number[]  // page numbers in this sheet
  canvas: HTMLCanvasElement | null
  thumbnail: string | null
}
