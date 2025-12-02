/**
 * PDF2 Module
 * 
 * Modern, modular PDF editing architecture for PrintFlow Pro.
 * 
 * This module provides:
 * - Clean separation of UI from logic
 * - Controller pattern with 6 attachment points
 * - Feature flag to switch between legacy and modern implementations
 * - Transform order: CROP → ROTATE → SCALE → TRANSLATE
 * 
 * Usage:
 *   import { usePdfController, USE_NEW_PDF_CONTROLLER } from '@/utils/pdf2'
 *   
 *   const { controller, loadDocument, applyEdit, exportRecipe } = usePdfController()
 */

// ============================================
// TYPES
// ============================================

export type {
  CropBox,
  RotationDegrees,
  PageTransforms,
  PageDimensions,
  PageInfo,
  PageMetadata,
  PageData,
  EditType,
  CropCommand,
  RotateCommand,
  ScaleCommand,
  TranslateCommand,
  ResetCommand,
  EditCommand,
  RecipeSource,
  RecipePrint,
  RecipePage,
  Recipe,
  ProgressCallback,
  PdfControllerOptions,
  PdfController,
  UIState,
  DragHandle,
  DragState,
  ImageRect,
  PagesPerSheet,
  GridSheet
} from './types'

export { DEFAULT_TRANSFORMS } from './types'

// ============================================
// STATE
// ============================================

export { MetadataStore } from './state/metadataStore'

// ============================================
// EDITS
// ============================================

export { CropService } from './edits/cropService'
export { RotationService } from './edits/rotationService'
export { ScaleService } from './edits/scaleService'
export { EditOrchestrator } from './edits/editOrchestrator'

// ============================================
// SERVICES
// ============================================

export { ProgressBus } from './services/progressBus'
export type { ProgressEventType, ProgressEvent, ProgressListener } from './services/progressBus'

export { PageState } from './services/pageState'
export { SelectionState } from './services/selectionState'

export { DocumentLoader } from './services/documentLoader'
export type { LoadResult } from './services/documentLoader'

export { PagePreviewService } from './services/pagePreviewService'

export { ThumbnailService } from './services/thumbnailService'
export type { ThumbnailOptions } from './services/thumbnailService'

export { RecipeService } from './services/recipeService'
export type { RecipeOptions } from './services/recipeService'

export { GridService } from './services/gridService'
export type { GridLayout } from './services/gridService'

// ============================================
// UI
// ============================================

export { CanvasInteraction, CropDragController } from './ui/canvasInteraction'
export type { InteractionMode, InteractionCallbacks, CropDrawParams, CropDragDeps, CropDragStart, CropDragHandle } from './ui/canvasInteraction'

export { UIStateManager } from './ui/uiState'
export type { LoadingStage, EditorTab, PaperSize, EditorSettings } from './ui/uiState'
export { DEFAULT_EDITOR_SETTINGS } from './ui/uiState'

export { CropHandler } from './ui/cropHandler'
export type { CropDrawParams as CropHandlerDrawParams } from './ui/cropHandler'

export { CoordinateHandler } from './ui/coordinateHandler'
export type { CanvasTransformBounds, TransformSettings } from './ui/coordinateHandler'

export { RotationHandler } from './ui/rotationHandler'
export type { RotationDirection, RotationState } from './ui/rotationHandler'

export { ToolbarHandler } from './ui/toolbarHandler'
export type { ApplyScope, PendingEdits, ToolbarState, ApplyResult, UnsavedAction } from './ui/toolbarHandler'

export { ZoomPanHandler, DEFAULT_ZOOM_CONFIG } from './ui/zoomPanHandler'
export type { ZoomConfig, PanBounds } from './ui/zoomPanHandler'

export { ApplyWorkflowHandler, DEFAULT_EDIT_HISTORY } from './ui/applyWorkflowHandler'
export type { EditHistory, NormalizedCropArea, ApplyPageState, ApplyAllSettings } from './ui/applyWorkflowHandler'

// ============================================
// CONTROLLER
// ============================================

export { LegacyAdapter } from './controller/legacyAdapter'
export type { LegacyPdfEditorRef } from './controller/legacyAdapter'

export { ModernAdapter } from './controller/modernAdapter'
export type { ModernAdapterOptions } from './controller/modernAdapter'

export {
  usePdfController,
  USE_NEW_PDF_CONTROLLER,
  isModernController,
  isLegacyController
} from './controller/usePdfController'
export type {
  UsePdfControllerOptions,
  UsePdfControllerResult
} from './controller/usePdfController'
