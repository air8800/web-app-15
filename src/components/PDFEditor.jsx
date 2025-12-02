import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf'
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url'
import { 
  PDFDocument,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath
} from 'pdf-lib'
import { X, Save, RotateCw, RotateCcw, Crop, RefreshCw, ZoomIn, ZoomOut, Move, Grid2x2 as Grid, Scissors, Check, CreditCard as Edit3, FileText, Maximize2, AlertCircle, Square, SquareCheck as CheckSquare, Loader2 } from 'lucide-react'
import { ShimmerLoader } from './ThumbnailLoadingStates'
import LoadingExperience from './LoadingExperience'
import { getPageSize, DEFAULT_PAGE_SIZE, PAGE_SIZES } from '../utils/pageSizes'
import { buildGeometricTransform, buildCanonicalTransform, calculateScaleToFit, remapCropBetweenRotations } from '../utils/pdf/geometry'
import { renderPage, applyStoredSettingsToPage, generateThumbnail } from '../utils/pdf/rendering'
import { applyColorFilter } from '../utils/pdf/filters'
import { USE_NEW_RENDERER, createRenderPageToCanvas } from '../utils/pdf/CanvasRendererAdapter'
import { combineConsecutivePagesForGrid } from '../utils/pdf/grid'
import { createPerformanceLogger } from '../utils/pdf/performanceLogger'
import { createMemoryTracker } from '../utils/memoryTracker'
import Dropdown from './Dropdown'
import UnsavedChangesPopup from './UnsavedChangesPopup'
import usePDFStore from '../stores/pdfStore'

import { 
  CropHandler, 
  RotationHandler, 
  ToolbarHandler,
  UIStateManager,
  CropDragController,
  CoordinateHandler,
  ZoomPanHandler,
  ApplyWorkflowHandler,
  usePdfController,
  USE_NEW_PDF_CONTROLLER
} from '../utils/pdf2'
import { setControllerBlocking } from '../stores/pdfStore'

if (USE_NEW_PDF_CONTROLLER) {
  setControllerBlocking(true)
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

// Module-level cache to survive React Strict Mode remounts
// Key: file signature (name_size_lastModified)
// Value: { loading: boolean, controller: AbortController, pdf: PDFDocumentProxy }
const fileLoadCache = new Map()

const PDFEditor = forwardRef(({ 
  file, 
  initialPageIndex = 0, 
  onSave, 
  onCancel, 
  directPageEdit = false, 
  pageSize = DEFAULT_PAGE_SIZE, 
  onPageSizeChange, 
  colorMode = 'BW', 
  pagesPerSheet = 1,
  selectedPages = [],
  onPageSelect = null
}, ref) => {
  console.log('📄 PDFEditor mounted with pagesPerSheet:', pagesPerSheet, 'Type:', typeof pagesPerSheet)
  
  const { setControllerRequested, setControllerActive, setThumbnail, setPDF: setPDFInStore, reset: resetPdfStore } = usePDFStore()
  
  useMemo(() => {
    if (USE_NEW_PDF_CONTROLLER) {
      setControllerRequested(true)
    }
  }, [])
  
  const [pages, setPages] = useState([])
  const [originalPages, setOriginalPages] = useState([])
  const [allPages, setAllPages] = useState([]) // Track ALL pages (loaded + placeholders)
  const [loading, setLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState(null) // null | 'parsing' | 'loading' | 'ready'
  const [error, setError] = useState(null)
  const [pdf, setPdf] = useState(null)
  const [currentPageSize, setCurrentPageSize] = useState(pageSize)
  const pageRefs = useRef({}) // Store refs for IntersectionObserver
  const perfLogger = useRef(null) // Performance logger
  const memoryTracker = useRef(null) // Memory tracker for RAM usage monitoring

  // Sync with parent page size changes
  useEffect(() => {
    if (pageSize !== currentPageSize) {
      setCurrentPageSize(pageSize)
    }
  }, [pageSize])

  const handlePageSizeChange = (newSize) => {
    setCurrentPageSize(newSize)
    if (onPageSizeChange) {
      onPageSizeChange(newSize)
    }
  }
  
  // Edit popup state
  const [showEditPopup, setShowEditPopup] = useState(false)
  const [editingPageIndex, setEditingPageIndex] = useState(initialPageIndex)
  const [editingPageNumber, setEditingPageNumber] = useState(initialPageIndex + 1) // Track page number separately
  
  // Edit settings for current page - geometric edits only
  const [settings, setSettings] = useState({
    rotation: 0,
    scale: 100,
    offsetX: 0,
    offsetY: 0
  })

  // Store user's intended scale separately (not affected by crop auto-adjustments)
  const [userScale, setUserScale] = useState(100)
  
  // Crop system
  const [cropMode, setCropMode] = useState(false)
  const [cropArea, setCropArea] = useState(null)
  const [pendingCropPreview, setPendingCropPreview] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragHandle, setDragHandle] = useState(null)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const rafRef = useRef(null)
  const [imageRect, setImageRect] = useState(null)
  const [showGrid, setShowGrid] = useState(false)
  const [zoom, setZoom] = useState(1)
  
  // UI state
  const [activeTab, setActiveTab] = useState('pagesize')
  const [tempPageSize, setTempPageSize] = useState(pageSize)
  const [showApplyWarning, setShowApplyWarning] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [applyProgress, setApplyProgress] = useState(0) // Track apply animation state
  const [isApplyingAll, setIsApplyingAll] = useState(false)
  const [applyAllProgress, setApplyAllProgress] = useState(0) // Track apply all animation state
  const [hasAppliedToAll, setHasAppliedToAll] = useState(false) // Track if Apply to All was done but not saved
  const [showScaleSlider, setShowScaleSlider] = useState(true)
  const [showCropSizeSlider, setShowCropSizeSlider] = useState(false)
  const [showUnsavedChangesPopup, setShowUnsavedChangesPopup] = useState(false)
  
  const canvasRef = useRef(null)
  const imageContainerRef = useRef(null)
  const debounceTimeoutRef = useRef(null)
  const loadingRemainingRef = useRef(false)
  const applyAllSettingsRef = useRef(null) // Store "Apply All" settings for lazy-loaded pages
  const loadingPagesRef = useRef(new Set()) // Track pages currently being loaded to prevent duplicates
  
  // Performance optimization refs
  const abortControllerRef = useRef(null) // Cancel PDF loading on unmount
  const pageLoadStatusRef = useRef(new Map()) // Track loading status: idle/loading/loaded
  const renderQueueRef = useRef([]) // Queue for sequential rendering
  const isRenderingRef = useRef(false) // Track if currently rendering
  const progressiveLoadCompleteRef = useRef(false) // Track when initial batch loaded
  const INITIAL_BATCH_SIZE = 2 // Disable IntersectionObserver for first 2 pages - faster initial load
  const currentFileIdRef = useRef(null) // Track current file ID for this component instance

  // ============================================
  // PDF2 UI HANDLERS (extracted for modularity)
  // These handlers encapsulate UI logic for crop, rotation, and toolbar actions
  // ============================================
  const cropHandlerRef = useRef(null)
  const rotationHandlerRef = useRef(null)
  const toolbarHandlerRef = useRef(null)
  const uiStateManagerRef = useRef(null)
  const cropDragControllerRef = useRef(null)
  const coordinateHandlerRef = useRef(null)
  const zoomPanHandlerRef = useRef(null)
  const applyWorkflowHandlerRef = useRef(null)

  // Initialize handlers once
  useMemo(() => {
    if (!cropHandlerRef.current) {
      cropHandlerRef.current = new CropHandler()
    }
    if (!rotationHandlerRef.current) {
      rotationHandlerRef.current = new RotationHandler()
    }
    if (!toolbarHandlerRef.current) {
      toolbarHandlerRef.current = new ToolbarHandler()
    }
    if (!uiStateManagerRef.current) {
      uiStateManagerRef.current = new UIStateManager()
    }
    if (!coordinateHandlerRef.current) {
      coordinateHandlerRef.current = new CoordinateHandler()
    }
    if (!zoomPanHandlerRef.current) {
      zoomPanHandlerRef.current = new ZoomPanHandler()
    }
    if (!applyWorkflowHandlerRef.current) {
      applyWorkflowHandlerRef.current = new ApplyWorkflowHandler()
    }
  }, [])

  // Convenience accessors
  const cropHandler = cropHandlerRef.current
  const rotationHandler = rotationHandlerRef.current
  const toolbarHandler = toolbarHandlerRef.current
  const uiStateManager = uiStateManagerRef.current
  const coordinateHandler = coordinateHandlerRef.current
  const zoomPanHandler = zoomPanHandlerRef.current
  const applyWorkflowHandler = applyWorkflowHandlerRef.current
  
  // Initialize CropDragController with dependencies (must be after refs are initialized)
  useMemo(() => {
    if (cropHandlerRef.current && !cropDragControllerRef.current) {
      cropDragControllerRef.current = new CropDragController({
        cropHandler: cropHandlerRef.current,
        getZoom: () => zoom,
        getCanvas: () => canvasRef.current,
        getContainer: () => canvasRef.current?.closest('.image-container')
      })
    }
  }, [])

  // ============================================
  // PDF2 CONTROLLER (NEW MODULAR ARCHITECTURE)
  // When USE_NEW_PDF_CONTROLLER is true, file loading and preview
  // rendering are delegated to ModernAdapter services
  // ============================================
  const {
    controller: pdfController,
    isReady: controllerReady,
    isLoading: controllerLoading,
    loadDocument: controllerLoadDocument
  } = usePdfController({ useNewImplementation: USE_NEW_PDF_CONTROLLER })

  // Track whether we're using the new controller
  const usingNewController = USE_NEW_PDF_CONTROLLER && pdfController !== null
  
  // Set controller flag early on mount to prevent PDFPageSelector race condition
  useEffect(() => {
    if (USE_NEW_PDF_CONTROLLER && pdfController !== null) {
      console.log('🏁 [PDFEditor] Setting controllerActive = true on mount')
      setControllerActive(true)
    }
    return () => {
      console.log('🧹 [PDFEditor] Clearing controller flags on unmount')
      setControllerActive(false)
      setControllerRequested(false)
      setControllerBlocking(false)
    }
  }, [pdfController, setControllerActive, setControllerRequested])
  
  const cropDragController = cropDragControllerRef.current

  // Helper to create file identifier
  const getFileId = (file) => {
    if (!file) return null
    return `${file.name}_${file.size}_${file.lastModified}`
  }

  // Helper to get page size with correct orientation based on actual PDF pages
  // Expose functions to parent component via ref
  useImperativeHandle(ref, () => ({
    exportPDF,
    clearAllEdits
  }))

  const getOrientationAwarePageSize = (sizeName) => {
    let targetPageSize = getPageSize(sizeName)
    
    // Detect orientation from first loaded page
    if (originalPages.length > 0) {
      const firstPage = originalPages[0]
      const isLandscape = firstPage.width > firstPage.height
      
      // If PDF is landscape but targetPageSize is portrait, swap dimensions
      if (isLandscape && targetPageSize.width < targetPageSize.height) {
        targetPageSize = {
          ...targetPageSize,
          width: targetPageSize.height,
          height: targetPageSize.width
        }
      }
    }
    
    return targetPageSize
  }

  useEffect(() => {
    console.log('🔍 [PDFEditor] useEffect file check:', { 
      hasFile: !!file, 
      fileType: file?.type, 
      USE_NEW_PDF_CONTROLLER,
      hasPdfController: !!pdfController 
    })
    if (file && file.type === 'application/pdf') {
      const fileId = getFileId(file)
      
      // Check if this is a NEW file (different from what this component instance is tracking)
      if (currentFileIdRef.current && currentFileIdRef.current !== fileId) {
        perfLogger.current?.log('🔄 New file detected - cleaning up previous file')
        // Clear the old file from module-level cache
        if (currentFileIdRef.current) {
          fileLoadCache.delete(currentFileIdRef.current)
          perfLogger.current?.log(`🗑️ Cleared cache for old file: ${currentFileIdRef.current}`)
        }
        // New file - abort previous load if exists
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
          abortControllerRef.current = null
        }
        // Clear all tracking
        loadingPagesRef.current.clear()
        pageLoadStatusRef.current.clear()
        renderQueueRef.current = []
        progressiveLoadCompleteRef.current = false
        // Reset shared store to prevent stale data
        resetPdfStore()
        // Clear pages to force reload
        setPages([])
        setOriginalPages([])
        setAllPages([])
      }
      
      // Check module-level cache
      const cachedLoad = fileLoadCache.get(fileId)
      
      if (cachedLoad && cachedLoad.loading) {
        // Another instance (from Strict Mode) is already loading this file
        perfLogger.current?.log('⏸️ Same file already loading (React Strict Mode) - skipping duplicate')
        // Reuse the controller from the first load
        abortControllerRef.current = cachedLoad.controller
        currentFileIdRef.current = fileId
        return
      }
      
      // Update current file tracker for this component
      currentFileIdRef.current = fileId
      loadPDF()
    }
    
    // Cleanup is handled by the controller mount effect
  }, [file])

  // Regenerate grid thumbnails when N-up or color mode changes
  useEffect(() => {
    console.log('🔄 useEffect triggered:', { pagesPerSheet, colorMode, originalPagesLength: originalPages.length })
    if (originalPages.length > 0) {
      console.log('✅ Calling updateGridThumbnails because originalPages exist')
      updateGridThumbnails()
    } else {
      console.log('⚠️ Skipping updateGridThumbnails - no originalPages yet')
    }
  }, [pagesPerSheet, colorMode])
  
  // In N-up mode, update sheets when new pages are loaded
  useEffect(() => {
    if (pagesPerSheet === 2 && originalPages.length > 0) {
      console.log('🔄 N-up mode: originalPages changed, updating sheets')
      updateGridThumbnails()
    }
  }, [originalPages.length, pagesPerSheet])

  useEffect(() => {
    setEditingPageIndex(initialPageIndex)
    setEditingPageNumber(initialPageIndex + 1)
    // If directPageEdit is true, open edit popup immediately
    if (directPageEdit && pages.length > 0) {
      setShowEditPopup(true)
    }
  }, [initialPageIndex, directPageEdit])
  
  // Recalculate editingPageIndex when pages array changes OR editingPageNumber changes
  useEffect(() => {
    if (pages.length > 0 && editingPageNumber) {
      const correctIndex = pages.findIndex(p => p.pageNumber === editingPageNumber)
      // Only update if the index actually changed
      if (correctIndex !== -1 && correctIndex !== editingPageIndex) {
        console.log(`📍 Recalculating editingPageIndex from ${editingPageIndex} to ${correctIndex}`)
        setEditingPageIndex(correctIndex)
      }
    }
  }, [pages.length, editingPageNumber]) // Trigger on pages.length OR editingPageNumber changes

  useEffect(() => {
    // Open edit popup when pages are loaded and directPageEdit is true
    if (directPageEdit && pages.length > 0 && !showEditPopup) {
      setShowEditPopup(true)
    }
  }, [pages, directPageEdit, showEditPopup])

  useEffect(() => {
    if (pages.length > 0 && showEditPopup) {
      // Cancel any pending animation frame
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      
      // Use RAF only for instant slider response
      rafRef.current = requestAnimationFrame(() => {
        applyEdits()
        rafRef.current = null
      })
    }
    
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [settings, editingPageIndex, showEditPopup, currentPageSize, colorMode, pagesPerSheet])

  const loadPDF = async () => {
    // ============================================
    // NEW MODULAR PATH: Use pdf2 controller
    // ============================================
    if (USE_NEW_PDF_CONTROLLER && pdfController) {
      console.log('🚀 [PDFEditor] Using NEW pdf2 controller for file loading')
      
      try {
        setLoading(true)
        setLoadingStage('parsing')
        setError(null)
        
        // Delegate to ModernAdapter
        await controllerLoadDocument(file)
        
        // Get page info from controller
        const pageCount = pdfController.getPageCount()
        console.log(`📄 [PDFEditor] Controller loaded ${pageCount} pages`)
        
        // Create skeleton placeholders immediately (before thumbnails)
        const skeletonPages = []
        for (let i = 1; i <= pageCount; i++) {
          const metadata = pdfController.getPageMetadata(i)
          skeletonPages.push({
            pageNumber: i,
            isLoaded: false,
            isLoading: true,
            thumbnail: null,
            width: metadata?.originalDimensions?.width || 595,
            height: metadata?.originalDimensions?.height || 842,
            canvas: null,
            originalCanvas: null,
            edited: false,
            editHistory: []
          })
        }
        
        // Show skeleton immediately
        setPages(skeletonPages)
        setOriginalPages(skeletonPages)
        setAllPages(skeletonPages)
        setLoadingStage('thumbnails')
        
        // Generate thumbnails progressively
        console.log(`🖼️ [PDFEditor] Generating thumbnails for ${pageCount} pages...`)
        const loadedPages = [...skeletonPages]
        
        // Load first 2 pages immediately for instant feedback
        const firstBatch = Math.min(2, pageCount)
        for (let i = 1; i <= firstBatch; i++) {
          try {
            const thumbnail = await pdfController.getThumbnailAsync(i)
            loadedPages[i - 1] = {
              ...loadedPages[i - 1],
              isLoaded: true,
              isLoading: false,
              thumbnail: thumbnail
            }
            setThumbnail(i, thumbnail)
            console.log(`✅ [PDFEditor] Thumbnail ${i}/${pageCount} loaded`)
          } catch (thumbErr) {
            console.warn(`⚠️ [PDFEditor] Thumbnail ${i} failed:`, thumbErr)
            loadedPages[i - 1] = {
              ...loadedPages[i - 1],
              isLoaded: true,
              isLoading: false
            }
          }
        }
        
        // Update state with first batch
        setPages([...loadedPages])
        setOriginalPages([...loadedPages])
        setAllPages([...loadedPages])
        setLoadingStage('ready')
        setLoading(false)
        
        console.log('✅ [PDFEditor] New controller path complete (first batch)')
        
        // Load remaining thumbnails in background
        if (pageCount > firstBatch) {
          console.log(`🔄 [PDFEditor] Loading remaining ${pageCount - firstBatch} thumbnails in background...`)
          for (let i = firstBatch + 1; i <= pageCount; i++) {
            try {
              const thumbnail = await pdfController.getThumbnailAsync(i)
              setThumbnail(i, thumbnail)
              setAllPages(prev => {
                const updated = [...prev]
                if (updated[i - 1]) {
                  updated[i - 1] = {
                    ...updated[i - 1],
                    isLoaded: true,
                    isLoading: false,
                    thumbnail: thumbnail
                  }
                }
                return updated
              })
            } catch (thumbErr) {
              console.warn(`⚠️ [PDFEditor] Background thumbnail ${i} failed:`, thumbErr)
            }
          }
          console.log('✅ [PDFEditor] All thumbnails loaded')
        }
        
        return
      } catch (err) {
        console.error('❌ [PDFEditor] Controller load failed:', err)
        setError(err.message || 'Failed to load PDF')
        setLoading(false)
        setControllerActive(false)
        setControllerRequested(false)
        setControllerBlocking(false)
        return
      }
    }
    
    // ============================================
    // LEGACY PATH: Original inline loading code
    // ============================================
    setControllerActive(false)
    setControllerRequested(false)
    setControllerBlocking(false)
    console.log('📄 [PDFEditor] Using LEGACY inline PDF loading')
    
    // Capture the controller at the start of this load operation
    // This prevents the "controller swap" bug where a new file load creates a new controller
    // and old tasks check the new controller instead of their original one
    let loadController = null
    const fileId = getFileId(file)
    
    try {
      // Initialize performance logger
      if (!perfLogger.current) {
        perfLogger.current = createPerformanceLogger('PDFEditor', true)
      }
      perfLogger.current.start()
      
      // Initialize memory tracker
      if (!memoryTracker.current) {
        memoryTracker.current = createMemoryTracker('PDFEditor')
      }
      memoryTracker.current.reset()
      memoryTracker.current.mark('📥 PDF Load - START (Baseline)')
      
      // Create new AbortController for this PDF load
      if (abortControllerRef.current) {
        perfLogger.current.log('⚠️ Aborting previous controller before creating new one')
        abortControllerRef.current.abort()
      }
      abortControllerRef.current = new AbortController()
      loadController = abortControllerRef.current // Capture for this load
      const loadSignal = loadController.signal
      perfLogger.current.log(`📌 Created new controller for file: ${fileId}`)
      
      // Register in module-level cache to prevent duplicate loads
      fileLoadCache.set(fileId, {
        loading: true,
        controller: loadController,
        pdf: null
      })
      
      // Reset all tracking
      pageLoadStatusRef.current.clear()
      loadingPagesRef.current.clear()
      progressiveLoadCompleteRef.current = false
      
      setLoading(true)
      setLoadingStage('parsing')
      setError(null)
      loadingRemainingRef.current = false // Reset flag on new PDF load
      
      // INSTANT SKELETON: Create full skeleton grid immediately (before parsing)
      // Use 12 placeholder tiles to avoid layout jump when actual pages load
      const skeletonPlaceholders = Array.from({ length: 12 }, (_, i) => ({
        pageNumber: i + 1,
        isLoaded: false,
        isLoading: true,
        thumbnail: null,
        width: 595,
        height: 842,
        canvas: null,
        originalCanvas: null,
        edited: false
      }))
      setAllPages(skeletonPlaceholders)
      
      // Stage 1: Convert file to ArrayBuffer
      perfLogger.current.mark('File Load Start')
      const arrayBuffer = await file.arrayBuffer()
      perfLogger.current.mark('File Load Complete')
      perfLogger.current.measure('File to ArrayBuffer', 'File Load Start', 'File Load Complete', {
        size: arrayBuffer.byteLength,
        sizeFormatted: `${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`
      })
      memoryTracker.current?.mark(`📄 File ArrayBuffer loaded (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`)
      
      // Stage 2: Parse PDF document (pdfjs-dist - lightweight)
      perfLogger.current.mark('PDF Parse Start')
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      perfLogger.current.mark('PDF Parse Complete')
      perfLogger.current.measure('PDF Parsing', 'PDF Parse Start', 'PDF Parse Complete', {
        pages: pdfDoc.numPages
      })
      memoryTracker.current?.mark(`📖 pdfjs-dist parsed (${pdfDoc.numPages} pages)`)
      
      setPdf(pdfDoc)
      
      // INSTANT EDITOR: Open UI immediately after PDF parsing
      const totalPages = pdfDoc.numPages
      // Guard against undefined/NaN initialPageIndex
      const safeIndex = Number.isFinite(initialPageIndex) ? initialPageIndex : 0
      const requestedPageNum = Math.min(safeIndex + 1, totalPages) // Convert 0-indexed to 1-indexed
      
      // Stage 3: Create placeholders
      perfLogger.current.mark('Placeholders Start')
      const allPagesPlaceholders = []
      
      // Check if N-up mode is active (pagesPerSheet === 2)
      if (pagesPerSheet === 2) {
        // Create sheet placeholders (2 pages per sheet)
        for (let i = 1; i <= totalPages; i += 2) {
          const page1Num = i
          const page2Num = i + 1
          const sheetPageNumber = page2Num <= totalPages ? `${page1Num}-${page2Num}` : `${page1Num}`
          
          allPagesPlaceholders.push({
            pageNumber: sheetPageNumber,
            isSheet: page2Num <= totalPages,
            containsPages: page2Num <= totalPages ? [page1Num, page2Num] : [page1Num],
            isLoaded: false,
            isLoading: false,
            thumbnail: null,
            width: 595,
            height: 842,
            canvas: null,
            originalCanvas: null,
            edited: false
          })
        }
      } else {
        // Create individual page placeholders
        for (let i = 1; i <= totalPages; i++) {
          allPagesPlaceholders.push({
            pageNumber: i,
            isLoaded: false,
            isLoading: false,
            thumbnail: null,
            width: 595, // A4 default
            height: 842,
            canvas: null,
            originalCanvas: null,
            edited: false
          })
        }
      }
      // Smoothly update placeholders - expand or contract as needed
      // If we have more pages than skeleton, add new ones
      // If we have fewer, remove extras
      // This avoids layout jump by keeping grid structure stable
      setAllPages(allPagesPlaceholders)
      setLoadingStage('loading')
      perfLogger.current.mark('Placeholders Complete')
      perfLogger.current.measure('Create Placeholders', 'Placeholders Start', 'Placeholders Complete', {
        count: totalPages
      })
      
      // Stop loading indicator NOW - editor opens immediately
      setLoading(false)
      perfLogger.current.markEditorReady()
      
      // Stage 4: Load first page
      perfLogger.current.log(`📄 Loading first page (${requestedPageNum})...`)
      
      // Mark as loading (prevent other loaders from loading this page)
      pageLoadStatusRef.current.set(requestedPageNum, 'loading')
      loadingPagesRef.current.add(requestedPageNum)
      
      const pageTimer = perfLogger.current.trackPageLoad(requestedPageNum, 'first')
      const firstPage = await renderPage(pdfDoc, requestedPageNum, pageTimer, { 
        thumbnailScale: 0.5, 
        thumbnailQuality: 0.4 
      })
      pageTimer.complete({ requestedPage: true })
      
      // Check if aborted (only check signal, not controller ref which changes on Strict Mode remount)
      if (loadSignal.aborted) {
        perfLogger.current.log(`🛑 Load aborted after first page render (signal aborted, fileId: ${fileId})`)
        // Clean up status
        pageLoadStatusRef.current.delete(requestedPageNum)
        loadingPagesRef.current.delete(requestedPageNum)
        return
      }
      
      if (firstPage) {
        // Mark as loaded
        pageLoadStatusRef.current.set(requestedPageNum, 'loaded')
        loadingPagesRef.current.delete(requestedPageNum)
        const pageData = {
          ...firstPage,
          canvas: firstPage.originalCanvas,
          thumbnail: firstPage.thumbnail,
          edited: false,
          editHistory: {
            rotation: 0,
            scale: 100,
            offsetX: 0,
            offsetY: 0,
            cropArea: null
          }
        }
        
        // Use functional update to preserve any existing state
        setOriginalPages(prev => {
          const updated = [...prev]
          updated[requestedPageNum - 1] = pageData
          return updated.filter(p => p !== null && p !== undefined)
        })
        setPages(prev => {
          const updated = [...prev]
          updated[requestedPageNum - 1] = pageData
          return updated.filter(p => p !== null && p !== undefined)
        })
        
        setEditingPageIndex(0)
        setEditingPageNumber(firstPage.pageNumber)
        
        // Mark page as loaded in allPages
        setAllPages(prev => prev.map(p => 
          p.pageNumber === firstPage.pageNumber 
            ? { ...firstPage, isLoaded: true, isLoading: false }
            : p
        ))
        
        perfLogger.current.log(`✅ First page loaded - editor ready!`)
        setLoadingStage('ready')
        memoryTracker.current?.mark('🎨 First page rendered to Canvas')
      }
      
      // Stage 5: Progressive loading queue for remaining pages
      perfLogger.current.mark('Progressive Loading Start')
      const pagesToLoad = []
      const start = Math.max(1, requestedPageNum - 1)
      const end = Math.min(totalPages, requestedPageNum + 1)
      
      // Queue nearby pages first (for smooth initial experience)
      for (let pageNum = start; pageNum <= end; pageNum++) {
        if (pageNum !== requestedPageNum) {
          pagesToLoad.push(pageNum)
        }
      }
      
      // Queue remaining pages
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        if (pageNum < start || pageNum > end) {
          pagesToLoad.push(pageNum)
        }
      }
      
      perfLogger.current.log(`📄 Queued ${pagesToLoad.length} pages for progressive loading`)
      
      let loadedCount = 1 // First page already loaded
      
      // Progressive loading function - one page at a time with functional updates
      const loadNextPage = async () => {
        // Check if aborted
        if (loadSignal.aborted) {
          perfLogger.current.log('🛑 Progressive loading aborted')
          return
        }
        
        if (pagesToLoad.length === 0) {
          perfLogger.current.mark('Progressive Loading Complete')
          perfLogger.current.measure('All Pages Loaded', 'Progressive Loading Start', 'Progressive Loading Complete', {
            totalPages: totalPages,
            loadedCount: loadedCount
          })
          perfLogger.current.log(`✅ All ${loadedCount} pages loaded`)
          perfLogger.current.logSummary()
          // Mark first batch complete to enable IntersectionObserver
          progressiveLoadCompleteRef.current = true
          return
        }
        
        const pageNum = pagesToLoad.shift()
        
        // Skip if already loaded or loading
        const status = pageLoadStatusRef.current.get(pageNum)
        if (status === 'loaded' || status === 'loading') {
          perfLogger.current.log(`⏭️ Page ${pageNum} already ${status}, skipping`)
          // Continue to next page
          if (pagesToLoad.length > 0) {
            if (typeof requestIdleCallback !== 'undefined') {
              requestIdleCallback(() => loadNextPage(), { timeout: 100 })
            } else {
              setTimeout(() => loadNextPage(), 10)
            }
          }
          return
        }
        
        try {
          // Mark as loading
          pageLoadStatusRef.current.set(pageNum, 'loading')
          loadingPagesRef.current.add(pageNum)
          
          const pageTimer = perfLogger.current.trackPageLoad(pageNum, 'progressive')
          const page = await renderPage(pdfDoc, pageNum, pageTimer, { 
            thumbnailScale: 0.5, 
            thumbnailQuality: 0.4 
          })
          pageTimer.complete()
          
          // Check if aborted after render
          if (loadSignal.aborted) {
            perfLogger.current.log('🛑 Progressive loading aborted after render')
            // Clean up status
            pageLoadStatusRef.current.delete(pageNum)
            loadingPagesRef.current.delete(pageNum)
            setAllPages(prev => prev.map(p => 
              p.pageNumber === pageNum ? { ...p, isLoading: false } : p
            ))
            return
          }
          
          if (page) {
            // Mark as loaded
            pageLoadStatusRef.current.set(pageNum, 'loaded')
            loadingPagesRef.current.delete(pageNum)
            
            // CRITICAL: Check if Apply All settings exist and apply them
            let displayPage = page
            let pageData = {
              ...page,
              canvas: page.originalCanvas,
              thumbnail: page.thumbnail,
              edited: false,
              editHistory: {
                rotation: 0,
                scale: 100,
                offsetX: 0,
                offsetY: 0,
                cropArea: null
              }
            }
            
            // Apply stored "Apply All" settings if they exist
            if (applyAllSettingsRef.current) {
              console.log(`📝 [BACKGROUND LOAD] Applying stored Apply All settings to page ${pageNum}`, applyAllSettingsRef.current.settings)
              displayPage = await applyStoredSettingsToPage(page, applyAllSettingsRef.current, getPageSize)
              console.log(`✅ [BACKGROUND LOAD] Apply All settings applied to page ${pageNum}`)
              
              // Update pageData to include the edits
              pageData = {
                ...displayPage,
                pristineOriginal: page.originalCanvas // Keep pristine for future edits
              }
            }
            
            // Functional update preserves concurrent edits
            // originalPages stores pristine for re-editing, pages/allPages show the display version
            setOriginalPages(prev => {
              // Check if page already exists (might have been loaded via IntersectionObserver)
              const exists = prev.find(p => p.pageNumber === pageNum)
              if (exists) return prev
              // Add new page and sort - use pageData which has pristineOriginal
              return [...prev, pageData].sort((a, b) => a.pageNumber - b.pageNumber)
            })
            
            setPages(prev => {
              // Check if page already exists
              const exists = prev.find(p => p.pageNumber === pageNum)
              if (exists) return prev
              // Add new page and sort - use displayPage which has edits applied
              return [...prev, displayPage].sort((a, b) => a.pageNumber - b.pageNumber)
            })
            
            // Mark as loaded in allPages
            setAllPages(prev => prev.map(p => 
              p.pageNumber === pageNum 
                ? { ...displayPage, isLoaded: true, isLoading: false }
                : p
            ))
            
            loadedCount++
            const progress = Math.round((loadedCount / totalPages) * 100)
            perfLogger.current.log(`✅ Page ${pageNum} loaded (${loadedCount}/${totalPages} - ${progress}%)`)
          }
        } catch (error) {
          perfLogger.current.log(`❌ Error loading page ${pageNum}: ${error.message}`)
          console.error(`❌ Error loading page ${pageNum}:`, error)
          // Mark as failed/idle so it can be retried
          pageLoadStatusRef.current.delete(pageNum)
          loadingPagesRef.current.delete(pageNum)
        }
        
        // Schedule next page load using requestIdleCallback for smooth UI
        if (pagesToLoad.length > 0) {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => loadNextPage(), { timeout: 100 })
          } else {
            // Fallback for browsers without requestIdleCallback
            setTimeout(() => loadNextPage(), 10)
          }
        }
      }
      
      // Start loading queue
      loadNextPage()
      
      perfLogger.current.log(`✅ PDF Editor - Initial page loaded, progressive loading started`)
      perfLogger.current.log(`ℹ️ Remaining ${totalPages - 1} pages loading progressively in background`)
      
      // DO NOT load remaining pages in background - let them load on scroll/demand only
      
    } catch (error) {
      console.error('❌ Error loading PDF:', error)
      perfLogger.current?.log(`❌ Fatal error: ${error.message}`)
      setError('Failed to load PDF: ' + error.message)
      // Clear cache on error
      fileLoadCache.delete(fileId)
    } finally {
      setLoading(false)
      // Mark loading as complete in cache
      const cached = fileLoadCache.get(fileId)
      if (cached) {
        cached.loading = false
      }
    }
  }


  // Load a single page on demand (for scroll-based loading)
  const loadSinglePage = useCallback(async (pageNumber) => {
    if (!pdf) return
    
    // Capture controller at start to prevent swap bug
    const controller = abortControllerRef.current
    const signal = controller?.signal
    
    // PERFORMANCE FIX: Disable IntersectionObserver for first INITIAL_BATCH_SIZE pages
    // Let progressive loader handle them to prevent triple loading collision
    if (pageNumber <= INITIAL_BATCH_SIZE && !progressiveLoadCompleteRef.current) {
      perfLogger.current?.log(`⏸️ Page ${pageNumber} in initial batch, skipping on-demand load`)
      return
    }
    
    // Check loading status using coordination system
    const status = pageLoadStatusRef.current.get(pageNumber)
    if (status === 'loaded' || status === 'loading') {
      perfLogger.current?.log(`⏭️ Page ${pageNumber} already ${status}, skipping on-demand load`)
      return
    }
    
    // Check if aborted
    if (signal?.aborted) {
      perfLogger.current?.log('🛑 On-demand load aborted')
      return
    }
    
    // Mark as loading
    pageLoadStatusRef.current.set(pageNumber, 'loading')
    loadingPagesRef.current.add(pageNumber)
    
    // Mark as loading in state (for UI)
    setAllPages(prev => prev.map(p => 
      p.pageNumber === pageNumber ? { ...p, isLoading: true } : p
    ))
    
    try {
      const pageTimer = perfLogger.current?.trackPageLoad(pageNumber, 'on-demand')
      perfLogger.current?.log(`📥 Loading page ${pageNumber} on demand`)
      const renderedPage = await renderPage(pdf, pageNumber, undefined, { 
        thumbnailScale: 0.5, 
        thumbnailQuality: 0.4 
      })
      pageTimer?.complete()
      
      // Check if aborted after render
      if (signal?.aborted) {
        perfLogger.current?.log('🛑 On-demand load aborted after render')
        // Clean up status
        pageLoadStatusRef.current.delete(pageNumber)
        loadingPagesRef.current.delete(pageNumber)
        setAllPages(prev => prev.map(p => 
          p.pageNumber === pageNumber ? { ...p, isLoading: false } : p
        ))
        return
      }
      
      if (renderedPage) {
        // Mark as loaded
        pageLoadStatusRef.current.set(pageNumber, 'loaded')
        loadingPagesRef.current.delete(pageNumber)
        // Keep pristine original (for future re-editing)
        const pristineOriginal = {
          ...renderedPage,
          canvas: renderedPage.originalCanvas,
          thumbnail: renderedPage.thumbnail,
          edited: false,
          editHistory: {
            rotation: 0,
            scale: 100,
            offsetX: 0,
            offsetY: 0,
            cropArea: null
          }
        }
        
        let displayPage = renderedPage
        let originalPageForSave = pristineOriginal
        
        // Apply stored "Apply All" settings if they exist
        if (applyAllSettingsRef.current) {
          console.log(`📝 [LAZY LOAD] Applying stored settings to page ${pageNumber}`, applyAllSettingsRef.current.settings)
          displayPage = await applyStoredSettingsToPage(renderedPage, applyAllSettingsRef.current, getPageSize)
          console.log(`✅ [LAZY LOAD] Settings applied to page ${pageNumber} successfully`)
          
          // IMPORTANT: Also store the edited version in originalPages so it gets saved with editHistory
          originalPageForSave = {
            ...displayPage,
            pristineOriginal: renderedPage.originalCanvas // Keep pristine for future edits
          }
        }
        
        // Safety check: only add if not already present
        // In N-up mode, skip adding individual pages (updateGridThumbnails will create sheets)
        if (pagesPerSheet !== 2) {
          setPages(prev => {
            if (prev.find(p => p.pageNumber === pageNumber)) {
              console.log(`⚠️ Page ${pageNumber} already in pages array, skipping`)
              return prev
            }
            return [...prev, displayPage].sort((a, b) => a.pageNumber - b.pageNumber)
          })
        } else {
          console.log(`📄 N-up mode: Skipping individual page ${pageNumber} add to pages array`)
        }
        
        setOriginalPages(prev => {
          if (prev.find(p => p.pageNumber === pageNumber)) {
            return prev
          }
          return [...prev, originalPageForSave].sort((a, b) => a.pageNumber - b.pageNumber)
        })
        
        // Update allPages with loaded page
        setAllPages(prev => prev.map(p => 
          p.pageNumber === pageNumber 
            ? { ...displayPage, isLoaded: true, isLoading: false }
            : p
        ))
        
        console.log(`✅ Loaded page ${pageNumber}`)
      }
    } catch (error) {
      console.error(`❌ Error loading page ${pageNumber}:`, error)
      // Mark as not loading on error
      setAllPages(prev => prev.map(p => 
        p.pageNumber === pageNumber ? { ...p, isLoading: false } : p
      ))
      // Remove from loading set and status (error - allow retry)
      loadingPagesRef.current.delete(pageNumber)
      pageLoadStatusRef.current.delete(pageNumber)
    }
  }, [pdf, applyAllSettingsRef, allPages])
  
  // Set up IntersectionObserver for scroll-based lazy loading
  useEffect(() => {
    if (allPages.length === 0 || !loadSinglePage) return
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const pageNumberStr = entry.target.dataset.pageNumber
            
            // Handle N-up sheet page numbers (e.g., "1-2", "3-4")
            if (pageNumberStr.includes('-')) {
              const [page1, page2] = pageNumberStr.split('-').map(n => parseInt(n))
              // Load both pages in the sheet
              console.log(`📄 Sheet ${pageNumberStr} visible - loading pages ${page1} and ${page2}`)
              loadSinglePage(page1)
              if (page2) loadSinglePage(page2)
            } else {
              // Single page number
              const pageNumber = parseInt(pageNumberStr)
              loadSinglePage(pageNumber)
            }
          }
        })
      },
      {
        root: null,
        rootMargin: '600px', // Start loading 600px before page enters viewport for smoother scrolling
        threshold: 0.01
      }
    )
    
    // Observe all page card elements
    Object.values(pageRefs.current).forEach(ref => {
      if (ref) observer.observe(ref)
    })
    
    return () => observer.disconnect()
  }, [allPages.length, pdf, loadSinglePage])

  const loadRemainingPages = async (pdfDoc, totalPages, alreadyLoadedPageNumbers) => {
    try {
      console.log(`🔄 loadRemainingPages: Loading remaining pages (skipping ${alreadyLoadedPageNumbers.size} already loaded)`)
      // Load pages in larger batches for faster completion
      const remainingPages = []
      for (let i = 1; i <= totalPages; i++) {
        // Skip already loaded pages
        if (alreadyLoadedPageNumbers.has(i)) {
          console.log(`⏭️ Skipping page ${i} (already loaded)`)
          continue
        }
        
        let page = await renderPage(pdfDoc, i, undefined, { 
          thumbnailScale: 0.5, 
          thumbnailQuality: 0.4 
        })
        if (page) {
          // Keep pristine original with cloned canvas
          const pristineOriginal = {
            ...page,
            canvas: page.originalCanvas, // Use the originalCanvas from renderPage
            thumbnail: page.thumbnail,
            edited: false,
            editHistory: {
              rotation: 0,
              scale: 100,
              offsetX: 0,
              offsetY: 0,
              cropArea: null
            }
          }
          
          let originalPageForSave = pristineOriginal
          
          // Apply stored "Apply All" settings if they exist
          if (applyAllSettingsRef.current) {
            console.log(`📝 [LAZY LOAD BATCH] Applying stored settings to page ${page.pageNumber}`, applyAllSettingsRef.current.settings)
            page = await applyStoredSettingsToPage(page, applyAllSettingsRef.current, getPageSize)
            console.log(`✅ [LAZY LOAD BATCH] Settings applied to page ${page.pageNumber} successfully`)
            
            // IMPORTANT: Also store the edited version in originalPages so it gets saved with editHistory
            originalPageForSave = {
              ...page,
              pristineOriginal: pristineOriginal.canvas // Keep pristine for future edits
            }
          }
          
          remainingPages.push({ display: page, original: originalPageForSave })
          console.log(`📄 Loaded page ${page.pageNumber} (${i}/${totalPages})`)
          
          // Update state after each batch of 15 pages to reduce re-renders
          if (remainingPages.length % 15 === 0 || i === totalPages) {
            const batch = [...remainingPages]
            remainingPages.length = 0 // Clear array for next batch
            console.log(`📦 Adding batch of ${batch.length} pages to state`)
            // In N-up mode, skip adding individual pages (updateGridThumbnails will create sheets)
            if (pagesPerSheet !== 2) {
              setPages(prevPages => {
                const displayPages = batch.map(b => b.display)
                return [...prevPages, ...displayPages].sort((a, b) => a.pageNumber - b.pageNumber)
              })
            } else {
              console.log(`📄 N-up mode: Skipping batch add to pages array (will create sheets from originalPages)`)
            }
            setOriginalPages(prevPages => {
              const origPages = batch.map(b => b.original)
              return [...prevPages, ...origPages].sort((a, b) => a.pageNumber - b.pageNumber)
            })
            // Longer delay after each batch to let UI breathe
            await new Promise(resolve => setTimeout(resolve, 50))
          }
        }
        
        // Minimal delay - just yield to UI every 5 pages
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1))
        }
      }
      console.log(`✅ Background loading complete - all ${totalPages} pages loaded`)
      memoryTracker.current?.mark(`🎨 All ${totalPages} pages rendered to Canvas`)
      memoryTracker.current?.printDetailedReport()
      loadingRemainingRef.current = false
    } catch (error) {
      console.error('❌ Error loading remaining pages:', error)
      loadingRemainingRef.current = false
    }
  }


  const updateGridThumbnails = async () => {
    console.log('🔄 updateGridThumbnails called:', { pagesPerSheet, originalPagesCount: originalPages.length, colorMode })
    console.log('🔍 pagesPerSheet value:', pagesPerSheet, 'Type:', typeof pagesPerSheet, 'Equals 2?:', pagesPerSheet === 2, 'Equals "2"?:', pagesPerSheet === '2')
    
    if (pagesPerSheet === 2) {
      console.log('📄 Creating N-up sheets from', originalPages.length, 'pages')
      const sheets = []

      for (let i = 0; i < originalPages.length; i += 2) {
        const page1 = originalPages[i]
        const page2 = originalPages[i + 1]

        if (!page1 || !page1.canvas) {
          console.warn(`⚠️ Page ${i + 1} is missing or has no canvas, skipping sheet creation`)
          continue
        }

        const filtered1 = applyColorFilter(page1.canvas, colorMode)

        if (page2 && page2.canvas) {
          const filtered2 = applyColorFilter(page2.canvas, colorMode)
          const combinedCanvas = combineConsecutivePagesForGrid(filtered1, filtered2, getOrientationAwarePageSize(currentPageSize))

          const sheet = {
            pageNumber: `${page1.pageNumber}-${page2.pageNumber}`,
            canvas: combinedCanvas,
            originalCanvas: combinedCanvas,
            thumbnail: generateThumbnail(combinedCanvas, 0.5, 0.6), // Use helper for consistent thumbnails
            width: combinedCanvas.width,
            height: combinedCanvas.height,
            isSheet: true,
            containsPages: [page1.pageNumber, page2.pageNumber],
            // Sheet is edited if EITHER underlying page is edited
            edited: !!(page1?.edited || page2?.edited)
          }
          sheets.push(sheet)
          console.log(`✅ Created sheet ${page1.pageNumber}-${page2.pageNumber}`)
        } else {
          // Single remaining page - ensure proper dimensions
          const singlePage = {
            ...page1,
            canvas: filtered1,
            width: filtered1.width,
            height: filtered1.height,
            thumbnail: generateThumbnail(filtered1, 0.5, 0.6), // Use helper for consistent thumbnails
            isSheet: false
          }
          sheets.push(singlePage)
          console.log(`✅ Added single page ${page1.pageNumber}`)
        }
      }

      console.log(`✅ Created ${sheets.length} N-up sheets/pages, setting as pages`)
      setPages(sheets)
      
      // Recreate allPages with sheet placeholders
      // CRITICAL: Preserve edited status from previous allPages state
      const totalPages = pdf?.numPages || originalPages.length * 2
      const sheetPlaceholders = []
      
      for (let i = 1; i <= totalPages; i += 2) {
        const page1Num = i
        const page2Num = i + 1
        const sheetPageNumber = page2Num <= totalPages ? `${page1Num}-${page2Num}` : `${page1Num}`
        
        // Check if this sheet is already loaded
        const loadedSheet = sheets.find(s => s.pageNumber === sheetPageNumber)
        const previousSheet = allPages.find(s => s.pageNumber === sheetPageNumber)
        
        if (loadedSheet) {
          // Use the loaded sheet
          sheetPlaceholders.push({
            ...loadedSheet,
            isLoaded: true,
            isLoading: false,
            // Preserve edited status from loaded sheet OR previous state
            edited: !!(loadedSheet?.edited || previousSheet?.edited)
          })
        } else {
          // Create placeholder
          sheetPlaceholders.push({
            pageNumber: sheetPageNumber,
            isSheet: page2Num <= totalPages,
            containsPages: page2Num <= totalPages ? [page1Num, page2Num] : [page1Num],
            isLoaded: false,
            isLoading: false,
            thumbnail: null,
            width: 595,
            height: 842,
            canvas: null,
            originalCanvas: null,
            // Preserve edited status from previous state if it exists
            edited: !!previousSheet?.edited
          })
        }
      }
      
      setAllPages(sheetPlaceholders)
      console.log(`📋 Created ${sheetPlaceholders.length} sheet placeholders in allPages`)
    } else {
      console.log('📄 Updating individual pages with color filter')
      const updatedPages = originalPages.map(page => {
        // Skip color filter if page has no canvas (new controller path uses thumbnails directly)
        if (!page.canvas) {
          console.log(`📄 Page ${page.pageNumber} has no canvas, using thumbnail directly`)
          return {
            ...page,
            // Keep existing thumbnail - no canvas to filter
            thumbnail: page.thumbnail
          }
        }
        const filtered = applyColorFilter(page.canvas, colorMode)
        return {
          ...page,
          canvas: filtered,
          // Reuse original thumbnail - color filter only affects canvas display, not stored thumbnail
          thumbnail: page.thumbnail || filtered.toDataURL('image/jpeg', 0.6)
        }
      })
      setPages(updatedPages)
      
      // Also recreate allPages with individual page placeholders (not sheets)
      // CRITICAL: Preserve edited status from previous allPages state
      const totalPages = pdf?.numPages || updatedPages.length
      const individualPlaceholders = []
      
      for (let i = 1; i <= totalPages; i++) {
        const loadedPage = updatedPages.find(p => p.pageNumber === i)
        const previousPage = allPages.find(p => p.pageNumber === i)
        
        if (loadedPage) {
          individualPlaceholders.push({
            ...loadedPage,
            isLoaded: true,
            isLoading: false,
            // Preserve edited status from loaded page OR previous state
            edited: !!(loadedPage?.edited || previousPage?.edited)
          })
        } else {
          individualPlaceholders.push({
            pageNumber: i,
            isLoaded: false,
            isLoading: false,
            thumbnail: null,
            width: 595,
            height: 842,
            canvas: null,
            originalCanvas: null,
            // Preserve edited status from previous state if it exists
            edited: !!previousPage?.edited
          })
        }
      }
      
      setAllPages(individualPlaceholders)
      const editedCount = individualPlaceholders.filter(p => p.edited).length
      console.log(`📋 Created ${individualPlaceholders.length} individual page placeholders in allPages (${editedCount} marked as edited)`)
    }
  }

  const loadPageOnDemand = async (pageNumber) => {
    if (!pdf) return null
    
    const existingPage = pages.find(p => p.pageNumber === pageNumber)
    if (existingPage) return existingPage
    
    console.log(`📄 Loading page ${pageNumber} on-demand...`)
    
    try {
      const renderedPage = await renderPage(pdf, pageNumber, undefined, { 
        thumbnailScale: 0.5, 
        thumbnailQuality: 0.4 
      })
      if (!renderedPage) return null
      
      const originalPage = {
        ...renderedPage,
        canvas: renderedPage.originalCanvas,
        thumbnail: renderedPage.thumbnail,
        edited: false,
        editHistory: {
          rotation: 0,
          scale: 100,
          offsetX: 0,
          offsetY: 0,
          cropArea: null
        }
      }
      
      let displayPage = renderedPage
      if (applyAllSettingsRef.current) {
        console.log(`📝 [ON-DEMAND LOAD] Applying stored settings to page ${pageNumber}`, applyAllSettingsRef.current.settings)
        displayPage = await applyStoredSettingsToPage(renderedPage, applyAllSettingsRef.current, getPageSize)
        console.log(`✅ [ON-DEMAND LOAD] Settings applied to page ${pageNumber} successfully`)
      }
      
      // In N-up mode, DON'T add individual pages to pages array
      // Just add to originalPages and let updateGridThumbnails create sheets
      if (pagesPerSheet !== 2) {
        setPages(prevPages => {
          const exists = prevPages.find(p => p.pageNumber === pageNumber)
          if (exists) return prevPages
          return [...prevPages, displayPage].sort((a, b) => a.pageNumber - b.pageNumber)
        })
      } else {
        console.log(`📄 N-up mode: Skipping individual page add to pages array`)
      }
      
      setOriginalPages(prevPages => {
        const exists = prevPages.find(p => p.pageNumber === pageNumber)
        if (exists) return prevPages
        return [...prevPages, originalPage].sort((a, b) => a.pageNumber - b.pageNumber)
      })
      
      console.log(`✅ Page ${pageNumber} loaded on-demand`)
      return displayPage
    } catch (error) {
      console.error(`❌ Error loading page ${pageNumber} on-demand:`, error)
      return null
    }
  }

  const openEditPopup = async (pageIndex) => {
    const page = pages[pageIndex]
    
    // NEW CONTROLLER PATH: Ensure canvas exists before opening popup
    if (USE_NEW_PDF_CONTROLLER && pdfController && page && !page.canvas && !page.originalCanvas) {
      console.log(`🖼️ [PDFEditor] Generating canvas for page ${page.pageNumber} on-demand...`)
      try {
        // Get preview canvas from controller
        const previewCanvas = await pdfController.getPagePreviewAsync(page.pageNumber, 800, 600)
        
        // Update the page with the canvas
        const pageNumber = page.pageNumber
        setOriginalPages(prev => {
          const updated = [...prev]
          const idx = updated.findIndex(p => p.pageNumber === pageNumber)
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              canvas: previewCanvas,
              originalCanvas: previewCanvas,
              pristineOriginal: previewCanvas
            }
          }
          return updated
        })
        setPages(prev => {
          const updated = [...prev]
          const idx = updated.findIndex(p => p.pageNumber === pageNumber)
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              canvas: previewCanvas,
              originalCanvas: previewCanvas,
              pristineOriginal: previewCanvas
            }
          }
          return updated
        })
        console.log(`✅ [PDFEditor] Canvas generated for page ${pageNumber}`)
      } catch (err) {
        console.error(`❌ [PDFEditor] Failed to generate canvas for page ${page.pageNumber}:`, err)
      }
    }
    
    setEditingPageIndex(pageIndex)
    setEditingPageNumber(pages[pageIndex]?.pageNumber) // Keep page number in sync
    setShowEditPopup(true)
    setActiveTab('pagesize')
    setCropMode(false)
    setCropArea(null)
    setImageRect(null)
    setHasAppliedToAll(false)  // Reset Apply to All state when opening new page

    // Load existing settings for this page (geometric only)
    
    // CRITICAL FIX: In N-up mode, load editHistory from underlying original page, not the sheet
    let editHistorySource = page
    if (pagesPerSheet === 2 && page?.isSheet) {
      // For sheets, get editHistory from the first underlying page
      let originalPageIndex = pageIndex * 2
      const originalPage = originalPages[originalPageIndex]
      if (originalPage) {
        editHistorySource = originalPage
        console.log(`📄 N-up mode: Loading editHistory from original page ${originalPage.pageNumber}`)
      }
    }
    
    if (editHistorySource && editHistorySource.editHistory) {
      const loadedScale = editHistorySource.editHistory.scale || 100
      setSettings({
        rotation: editHistorySource.editHistory.rotation || 0,
        scale: loadedScale,
        offsetX: editHistorySource.editHistory.offsetX || 0,
        offsetY: editHistorySource.editHistory.offsetY || 0
      })
      setUserScale(loadedScale)
      console.log(`✅ Loaded editHistory:`, editHistorySource.editHistory)
      
      // CRITICAL: If page was cropped, restore pendingCropPreview so rotation/scale can work on it
      if (editHistorySource.editHistory.isCropped && editHistorySource.editHistory.contentCanvas) {
        console.log(`📐 Restoring pendingCropPreview from saved cropped page for continued editing`)
        const contentCanvas = editHistorySource.editHistory.contentCanvas
        const targetPageSize = getOrientationAwarePageSize(currentPageSize)
        
        // Create page canvas with content centered (same as when saving)
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = targetPageSize.width
        pageCanvas.height = targetPageSize.height
        const pageCtx = pageCanvas.getContext('2d')
        pageCtx.fillStyle = 'white'
        pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
        
        const fitToPage = editHistorySource.editHistory.fitCropToPage || false
        const drawParams = computeCenteredCropDrawParams(
          pageCanvas.width, pageCanvas.height,
          contentCanvas.width, contentCanvas.height,
          fitToPage
        )
        pageCtx.drawImage(contentCanvas, drawParams.drawX, drawParams.drawY, drawParams.drawWidth, drawParams.drawHeight)
        
        const restoredPreview = {
          canvas: pageCanvas,
          contentCanvas: contentCanvas,
          contentWidth: contentCanvas.width,
          contentHeight: contentCanvas.height,
          width: pageCanvas.width,
          height: pageCanvas.height,
          thumbnail: generateThumbnail(pageCanvas, 0.5, 0.6),
          fitCropToPage: fitToPage,
          isRestoredFromSave: true,  // Mark as restored - not unsaved changes
          pageIndex: pageIndex,
          settings: {
            rotation: editHistorySource.editHistory.rotation || 0,
            scale: loadedScale,
            offsetX: 0,
            offsetY: 0
          }
        }
        setPendingCropPreview(restoredPreview)
        console.log(`✅ Restored pendingCropPreview with contentCanvas ${contentCanvas.width}x${contentCanvas.height}`)
        
        // Update display canvas immediately after state is set
        setTimeout(() => {
          if (canvasRef.current) {
            const canvas = canvasRef.current
            const ctx = canvas.getContext('2d')
            canvas.width = pageCanvas.width
            canvas.height = pageCanvas.height
            ctx.drawImage(pageCanvas, 0, 0)
            console.log(`✅ Display canvas updated with restored crop preview`)
          }
        }, 50)
      } else {
        setPendingCropPreview(null)
      }
    } else {
      setSettings({
        rotation: 0,
        scale: 100,
        offsetX: 0,
        offsetY: 0
      })
      setUserScale(100)
      setPendingCropPreview(null)
      console.log(`📄 No editHistory found - using defaults`)
    }

    setZoom(1)
  }

  const closeEditPopup = () => {
    // If Apply to All was done, auto-save and close (no popup)
    if (hasAppliedToAll) {
      console.log('🔄 Auto-saving Apply to All changes and closing editor')
      setHasAppliedToAll(false)
      applyAllChanges()  // This will save and close automatically
      return
    }
    
    // Check for other unsaved changes before closing
    if (hasUnsavedChanges()) {
      setShowUnsavedChangesPopup(true)
      return
    }
    
    // Clean up all editor state
    performCloseEditPopup()
  }

  const performCloseEditPopup = () => {
    // Clean up all editor state
    setActiveTab('pagesize')
    setCropMode(false)
    setCropArea(null)
    setPendingCropPreview(null)
    setImageRect(null)
    setZoom(1)
    setShowUnsavedChangesPopup(false)
    setHasAppliedToAll(false)  // Clear Apply to All pending state

    if (directPageEdit) {
      // If opened directly from preview, close entire editor
      onCancel()
    } else {
      // If opened from PDF grid, go back to grid
      setShowEditPopup(false)
    }
  }

  const clearPageEdits = () => {
    const pageIndex = editingPageIndex
    if (!pages[pageIndex]) return

    console.log('🔄 Clearing all edits for page', pages[pageIndex].pageNumber)

    // Reset transform settings
    setSettings({
      rotation: 0,
      scale: 100,
      offsetX: 0,
      offsetY: 0
    })
    setUserScale(100)

    // Reset crop state
    setCropMode(false)
    setCropArea(null)
    setPendingCropPreview(null)
    setImageRect(null)

    // Update the page to remove edits
    const page = pages[pageIndex]
    const updatedPages = [...pages]

    // Restore to pristine state
    const pristineCanvas = page.pristineOriginal || page.originalCanvas || page.canvas
    updatedPages[pageIndex] = {
      ...page,
      canvas: pristineCanvas,
      thumbnail: generateThumbnail(pristineCanvas, 0.5, 0.6),
      edited: false,
      width: pristineCanvas.width,
      height: pristineCanvas.height,
      cropInfo: null,
      editHistory: {
        rotation: 0,
        scale: 100,
        offsetX: 0,
        offsetY: 0,
        cropArea: null,
        isCropped: false
      }
    }

    setPages(updatedPages)

    // Also update originalPages if in single page mode
    if (pagesPerSheet !== 2 || !page.isSheet) {
      const origIndex = pagesPerSheet === 2
        ? originalPages.findIndex(p => p.pageNumber === page.pageNumber)
        : pageIndex

      if (origIndex >= 0 && origIndex < originalPages.length) {
        const origPage = originalPages[origIndex]
        const updateOriginalPages = [...originalPages]
        const prisOrigCanvas = origPage.pristineOriginal || origPage.originalCanvas || origPage.canvas

        updateOriginalPages[origIndex] = {
          ...origPage,
          canvas: prisOrigCanvas,
          thumbnail: generateThumbnail(prisOrigCanvas, 0.5, 0.6),
          edited: false,
          width: prisOrigCanvas.width,
          height: prisOrigCanvas.height,
          cropInfo: null,
          editHistory: {
            rotation: 0,
            scale: 100,
            offsetX: 0,
            offsetY: 0,
            cropArea: null,
            isCropped: false
          }
        }
        setOriginalPages(updateOriginalPages)
        console.log('✅ Edits cleared for original page', origPage.pageNumber)
      }
    }

    // Update the canvas display
    requestAnimationFrame(() => {
      if (canvasRef.current) {
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        canvas.width = pristineCanvas.width
        canvas.height = pristineCanvas.height
        ctx.drawImage(pristineCanvas, 0, 0)
        console.log('✅ Canvas reset to pristine state')
      }
    })

    toast.success('All edits cleared! Starting fresh.', {
      position: 'bottom-center',
      duration: 3000
    })
  }

  const applyEdits = () => {
    console.log(`🎬 [applyEdits] START - editingPageIndex: ${editingPageIndex}`)
    if (!pages[editingPageIndex] || !canvasRef.current) {
      console.log(`🎬 [applyEdits] ABORT - no page or canvas (pages[${editingPageIndex}]: ${!!pages[editingPageIndex]}, canvasRef: ${!!canvasRef.current})`)
      return
    }

    // CRITICAL: If there's a pending crop preview, draw that instead of re-rendering
    // This preserves the cropped + rotated preview when settings change
    if (pendingCropPreview && pendingCropPreview.pageIndex === editingPageIndex) {
      console.log('📐 Using pendingCropPreview for display (preserving crop+rotation)')
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d', { alpha: false })
      canvas.width = pendingCropPreview.canvas.width
      canvas.height = pendingCropPreview.canvas.height
      ctx.drawImage(pendingCropPreview.canvas, 0, 0)
      return
    }

    const pageIndex = editingPageIndex
    const page = pages[pageIndex]
    console.log(`🎬 [applyEdits] page ${page.pageNumber}: canvas=${!!page.canvas}, originalCanvas=${!!page.originalCanvas}, pristineOriginal=${!!page.pristineOriginal}`)
    
    // CRITICAL: If page has isCropped=true, the canvas already has ALL transformations baked in
    // (rotation, scale, offset, crop) WITH 5% margin. Just draw it directly!
    if (page.editHistory?.isCropped && page.canvas) {
      console.log('📐 Page has isCropped=true - drawing pre-transformed canvas directly (margin already applied)')
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d', { alpha: false })
      
      // The saved canvas already has the content positioned with 5% margin
      // Just draw it directly to match the live preview exactly
      const sourceCanvas = page.canvas
      canvas.width = sourceCanvas.width
      canvas.height = sourceCanvas.height
      ctx.drawImage(sourceCanvas, 0, 0)
      return
    }

    // When N-up is active, map sheet index to original page index
    let originalPageIndex = pageIndex
    if (pagesPerSheet === 2) {
      if (page.isSheet) {
        // For N-up sheets, Sheet 0 = pages 0,1; Sheet 1 = pages 2,3; etc.
        originalPageIndex = pageIndex * 2
      } else {
        // For single pages in N-up mode, find the correct original page by pageNumber
        originalPageIndex = originalPages.findIndex(p => p.pageNumber === page.pageNumber)
        if (originalPageIndex === -1) {
          console.error('❌ Could not find original page for', page.pageNumber)
          originalPageIndex = pageIndex
        }
      }
    }

    const originalPage = originalPages[originalPageIndex]
    console.log(`🎬 [applyEdits] originalPage ${originalPage?.pageNumber}: canvas=${!!originalPage?.canvas}, originalCanvas=${!!originalPage?.originalCanvas}, pristineOriginal=${!!originalPage?.pristineOriginal}`)
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { alpha: false })

    // Disable smoothing for fastest rendering during slider movement
    ctx.imageSmoothingEnabled = false

    // Get target page size dimensions with correct orientation
    const targetPageSize = getOrientationAwarePageSize(currentPageSize)

    // CHECK N-UP MODE FIRST to prevent flicker
    const isNupMode = pagesPerSheet === 2 && page.isSheet

    // LEGACY: Original inline render function (kept for comparison/fallback)
    const legacyRenderPageToCanvas = (targetCanvas, sourceOriginalPage, applySettings) => {
      const targetCtx = targetCanvas.getContext('2d', { alpha: false })
      targetCtx.imageSmoothingEnabled = false
      
      // CRITICAL FIX: Only use pre-centered cropped canvas if ONLY crop was applied (no rotation, scale, offset)
      // The pre-centered canvas already has the crop centered with proper white space
      const hasOnlyCrop = applySettings.cropArea && sourceOriginalPage.editHistory?.isCropped && 
                          (!applySettings.rotation || applySettings.rotation === 0) && 
                          (!applySettings.scale || applySettings.scale === 100 || Math.abs(applySettings.scale - 100) < 0.01) && 
                          (!applySettings.offsetX || Math.abs(applySettings.offsetX) < 0.01) && 
                          (!applySettings.offsetY || Math.abs(applySettings.offsetY) < 0.01)
      
      if (hasOnlyCrop && sourceOriginalPage.canvas) {
        // Clear canvas with white background
        targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
        targetCtx.fillStyle = 'white'
        targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)
        
        // Draw the pre-centered canvas, scaling to fit target if dimensions differ
        const sourceCanvas = sourceOriginalPage.canvas
        
        if (sourceCanvas.width === targetCanvas.width && sourceCanvas.height === targetCanvas.height) {
          // Perfect match - draw directly at 1:1
          targetCtx.drawImage(sourceCanvas, 0, 0)
        } else {
          // Dimensions differ - scale and center to fit (10% margin to prevent overflow)
          const scaleX = targetCanvas.width / sourceCanvas.width
          const scaleY = targetCanvas.height / sourceCanvas.height
          const scale = Math.min(scaleX, scaleY) * 0.90 // Fit within target with 10% margin
          
          const scaledWidth = sourceCanvas.width * scale
          const scaledHeight = sourceCanvas.height * scale
          const x = (targetCanvas.width - scaledWidth) / 2
          const y = (targetCanvas.height - scaledHeight) / 2
          
          targetCtx.drawImage(sourceCanvas, x, y, scaledWidth, scaledHeight)
        }
        
        // Apply color mode filter if needed
        if (colorMode === 'BW') {
          const tempCanvas = document.createElement('canvas')
          tempCanvas.width = targetCanvas.width
          tempCanvas.height = targetCanvas.height
          const tempCtx = tempCanvas.getContext('2d')
          tempCtx.filter = 'grayscale(100%)'
          tempCtx.drawImage(targetCanvas, 0, 0)
          
          targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
          targetCtx.fillStyle = 'white'
          targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)
          targetCtx.drawImage(tempCanvas, 0, 0)
        }
        
        return // Skip geometric transform pipeline for pre-centered crops
      }
      
      // Get source canvas (pristineOriginal to prevent transformation compounding)
      const sourceCanvas = sourceOriginalPage.pristineOriginal || sourceOriginalPage.originalCanvas || sourceOriginalPage.canvas
      const originalWidth = sourceOriginalPage.width
      const originalHeight = sourceOriginalPage.height
      
      // Build editHistory
      const editHistory = {
        rotation: applySettings.rotation,
        scale: applySettings.scale,
        offsetX: applySettings.offsetX,
        offsetY: applySettings.offsetY,
        cropArea: applySettings.cropArea
      }
      
      // Use CANONICAL transformation helper (robust for all edit combinations)
      const transform = buildCanonicalTransform(
        { width: originalWidth, height: originalHeight },
        targetPageSize,
        editHistory
      )
      
      // Clear canvas with white background
      targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
      targetCtx.fillStyle = 'white'
      targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)
      
      // Apply transformations
      targetCtx.save()
      targetCtx.translate(targetCanvas.width / 2, targetCanvas.height / 2)
      targetCtx.translate(applySettings.offsetX, applySettings.offsetY)

      if (applySettings.rotation !== 0) {
        targetCtx.rotate((applySettings.rotation * Math.PI) / 180)
      }

      // Draw using source rectangle (crop)
      targetCtx.drawImage(
        sourceCanvas,
        transform.sourceRect.x,
        transform.sourceRect.y,
        transform.sourceRect.width,
        transform.sourceRect.height,
        transform.drawX,
        transform.drawY,
        transform.drawWidth,
        transform.drawHeight
      )
      
      targetCtx.restore()

      // Apply color mode filter
      if (colorMode === 'BW') {
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = targetCanvas.width
        tempCanvas.height = targetCanvas.height
        const tempCtx = tempCanvas.getContext('2d')
        tempCtx.filter = 'grayscale(100%)'
        tempCtx.drawImage(targetCanvas, 0, 0)
        
        targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
        targetCtx.fillStyle = 'white'
        targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)
        targetCtx.drawImage(tempCanvas, 0, 0)
      }
    }

    // ADAPTER: Create adapter-based renderer if feature flag is enabled
    const adapterRenderPageToCanvas = USE_NEW_RENDERER 
      ? createRenderPageToCanvas({ colorMode, targetPageSize })
      : null

    // WRAPPER: Switch between legacy and adapter based on feature flag
    const renderPageToCanvas = USE_NEW_RENDERER && adapterRenderPageToCanvas
      ? adapterRenderPageToCanvas
      : legacyRenderPageToCanvas

    // BRANCH: N-up mode vs single page mode
    if (isNupMode) {
      // Create temp canvases for both pages
      const page1Canvas = document.createElement('canvas')
      page1Canvas.width = targetPageSize.width
      page1Canvas.height = targetPageSize.height
      
      const page2Canvas = document.createElement('canvas')
      page2Canvas.width = targetPageSize.width
      page2Canvas.height = targetPageSize.height
      
      // Render page 1
      const currentSettings = {
        rotation: settings.rotation,
        scale: settings.scale,
        offsetX: settings.offsetX,
        offsetY: settings.offsetY,
        cropArea: cropArea || (page.editHistory?.cropArea)
      }
      renderPageToCanvas(page1Canvas, originalPage, currentSettings)

      // Render page 2 if it exists
      const nextOriginalPageIndex = originalPageIndex + 1
      if (nextOriginalPageIndex < originalPages.length) {
        const nextOriginalPage = originalPages[nextOriginalPageIndex]
        renderPageToCanvas(page2Canvas, nextOriginalPage, currentSettings)
      } else {
        // No page 2 available, fill with white
        const page2Ctx = page2Canvas.getContext('2d')
        page2Ctx.fillStyle = 'white'
        page2Ctx.fillRect(0, 0, page2Canvas.width, page2Canvas.height)
      }

      // Create WIDE landscape canvas
      const gap = 12
      canvas.width = page1Canvas.width * 2 + gap
      canvas.height = page1Canvas.height

      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const halfWidth = canvas.width / 2
      const margin = 3

      // Draw thin page boundaries
      ctx.strokeStyle = '#3B82F6'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 6])
      ctx.strokeRect(margin, margin, halfWidth - gap / 2 - margin, canvas.height - margin * 2)
      ctx.strokeRect(halfWidth + gap / 2, margin, halfWidth - gap / 2 - margin, canvas.height - margin * 2)
      ctx.setLineDash([])

      // Pages fill the width - like slides
      const pageWidth = halfWidth - gap / 2 - margin * 3
      const pageHeight = canvas.height - margin * 4

      // Draw first page (left) - FILL width
      ctx.drawImage(page1Canvas, margin * 2, margin * 2, pageWidth, pageHeight)

      // Draw SECOND PAGE (right) - different page!
      ctx.drawImage(page2Canvas, halfWidth + gap / 2 + margin, margin * 2, pageWidth, pageHeight)

      // Add label
      ctx.fillStyle = '#3B82F6'
      ctx.font = 'bold 14px Inter, sans-serif'
      ctx.textAlign = 'center'
      const pageLabel = nextOriginalPageIndex < originalPages.length
        ? `Pages ${originalPageIndex + 1}-${nextOriginalPageIndex + 1} (2 Per Sheet)`
        : `Page ${originalPageIndex + 1} (2 Per Sheet)`
      ctx.fillText(pageLabel, canvas.width / 2, canvas.height - 8)
    } else {
      // SINGLE PAGE MODE - Render directly to main canvas
      // Set canvas to target page size
      canvas.width = targetPageSize.width
      canvas.height = targetPageSize.height
      
      // Render the page
      const currentSettings = {
        rotation: settings.rotation,
        scale: settings.scale,
        offsetX: settings.offsetX,
        offsetY: settings.offsetY,
        cropArea: cropArea || (page.editHistory?.cropArea)
      }
      renderPageToCanvas(canvas, originalPage, currentSettings)
    }
  }

  /**
   * Get canvas transformation bounds
   * NOW USES: coordinateHandler.calculateTransformBounds for pure math (extracted to pdf2/ui/coordinateHandler.ts)
   */
  const getCanvasTransformedBounds = () => {
    if (!canvasRef.current) return null

    const canvas = canvasRef.current
    const page = pages[editingPageIndex]
    if (!page) return null

    // Get correct original page index for N-up mode (state-dependent)
    let originalPageIndex = editingPageIndex
    if (pagesPerSheet === 2) {
      if (page.isSheet) {
        originalPageIndex = editingPageIndex * 2
      } else {
        originalPageIndex = originalPages.findIndex(p => p.pageNumber === page.pageNumber)
        if (originalPageIndex === -1) originalPageIndex = editingPageIndex
      }
    }

    const originalPage = originalPages[originalPageIndex]
    let sourceWidth = originalPage ? originalPage.width : page.width
    let sourceHeight = originalPage ? originalPage.height : page.height

    // If page has been cropped, use the cropped canvas dimensions as source
    const isCropped = page.editHistory && page.editHistory.isCropped && page.canvas
    if (isCropped) {
      sourceWidth = page.canvas.width
      sourceHeight = page.canvas.height
    }

    // DELEGATED: Use coordinateHandler for pure transform calculations
    return coordinateHandler.calculateTransformBounds(
      canvas.width,
      canvas.height,
      { width: sourceWidth, height: sourceHeight },
      settings
    )
  }

  /**
   * Update image rect relative to container
   * NOW USES: coordinateHandler.calculateImageRect for pure math (extracted to pdf2/ui/coordinateHandler.ts)
   */
  const updateImageRect = () => {
    if (!canvasRef.current) {
      console.log('❌ Canvas not found for updateImageRect')
      return
    }

    const canvas = canvasRef.current
    const canvasRect = canvas.getBoundingClientRect()
    const container = canvas.closest('.image-container')
    const containerRect = container ? container.getBoundingClientRect() : { left: 0, top: 0 }

    // DELEGATED: Use coordinateHandler for pure rect calculation
    const newImageRect = coordinateHandler.calculateImageRect(canvasRect, containerRect)

    console.log('📐 Image rect calculated:', {
      canvasRect,
      containerRect,
      imageRect: newImageRect
    })

    setImageRect(newImageRect)
  }

  /**
   * Transform screen coordinates to source coordinates
   * NOW USES: coordinateHandler.screenToSource for pure math (extracted to pdf2/ui/coordinateHandler.ts)
   */
  const getTransformedCoordinates = (screenX, screenY) => {
    if (!canvasRef.current) return { x: 0, y: 0 }

    const canvas = canvasRef.current
    const container = canvas.closest('.image-container')
    const containerRect = container.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()

    const bounds = getCanvasTransformedBounds()
    if (!bounds) return { x: 0, y: 0 }

    // DELEGATED: Use coordinateHandler for pure coordinate transformation
    return coordinateHandler.screenToSource(
      screenX,
      screenY,
      containerRect,
      canvasRect,
      zoom,
      settings,
      bounds
    )
  }

  /**
   * Computes centered crop draw parameters for consistent centering across preview, canvas, and PDF export
   * NOW DELEGATED TO: cropHandler.computeCenteredCropDrawParams (extracted to pdf2/ui/cropHandler.ts)
   * @param {number} pageWidth - Target page/canvas width
   * @param {number} pageHeight - Target page/canvas height
   * @param {number} cropWidth - Actual crop width
   * @param {number} cropHeight - Actual crop height
   * @param {boolean} fitCropToPage - If true, scale crop to fill page; if false, center at actual size
   * @returns {{ drawX: number, drawY: number, drawWidth: number, drawHeight: number }}
   */
  const computeCenteredCropDrawParams = (pageWidth, pageHeight, cropWidth, cropHeight, fitCropToPage = false) => {
    return cropHandler.computeCenteredCropDrawParams(pageWidth, pageHeight, cropWidth, cropHeight, fitCropToPage)
  }

  /**
   * Start crop mode - initialize crop area
   * NOW DELEGATED TO: cropHandler.initializeCropArea (extracted to pdf2/ui/cropHandler.ts)
   */
  const startCrop = () => {
    console.log('🎯 Starting crop mode')
    setCropMode(true)

    setTimeout(() => {
      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const container = canvas.closest('.image-container')
        const containerRect = container.getBoundingClientRect()

        const imageRect = {
          left: rect.left - containerRect.left,
          top: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height
        }

        setImageRect(imageRect)

        // DELEGATED: Use cropHandler for crop area initialization
        const canvasPixelWidth = canvas.width
        const canvasPixelHeight = canvas.height
        const initialCrop = cropHandler.initializeCropArea(canvasPixelWidth, canvasPixelHeight, 0.1)

        console.log('🎯 Initializing crop in CANVAS PIXEL SPACE (page boundaries):', {
          canvasSize: `${canvasPixelWidth}×${canvasPixelHeight}`,
          cropArea: `${initialCrop.x.toFixed(1)}, ${initialCrop.y.toFixed(1)}, ${initialCrop.width.toFixed(1)}×${initialCrop.height.toFixed(1)}`
        })

        setCropArea(initialCrop)

        console.log('🎯 Canvas boundaries set:', imageRect)
      }
    }, 200)
  }

  /**
   * Handle mouse down on crop handles
   * NOW DELEGATED TO: cropDragController.startDrag (extracted to pdf2/ui/canvasInteraction.ts)
   */
  const handleMouseDown = (e, handle) => {
    if (!cropMode || !cropArea) return

    e.preventDefault()
    e.stopPropagation()

    setIsDragging(true)
    setDragHandle(handle)

    // Delegate to CropDragController
    if (cropDragController) {
      cropDragController.startDrag(e.clientX, e.clientY, handle, cropArea)
    }
  }

  /**
   * Handle mouse move during crop drag
   * NOW DELEGATED TO: cropDragController.continueDrag (extracted to pdf2/ui/canvasInteraction.ts)
   */
  const handleMouseMove = (e) => {
    if (!isDragging || !cropArea) return

    e.preventDefault()

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }

    rafRef.current = requestAnimationFrame(() => {
      if (cropDragController) {
        const newCropArea = cropDragController.continueDrag(e.clientX, e.clientY)
        if (newCropArea) {
          setCropArea(newCropArea)
        }
      }
    })
  }

  /**
   * Handle mouse up to end crop drag
   * NOW DELEGATED TO: cropDragController.endDrag (extracted to pdf2/ui/canvasInteraction.ts)
   */
  const handleMouseUp = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setIsDragging(false)
    setDragHandle(null)
    
    // Delegate to CropDragController
    if (cropDragController) {
      cropDragController.endDrag()
    }
  }

  /**
   * Apply crop to the current page
   * NOW USES: cropHandler.normalizeCropBounds for boundary calculations (extracted to pdf2/ui/cropHandler.ts)
   */
  const applyCrop = async () => {
    if (!cropArea || !pages[editingPageIndex]) return

    try {
      console.log('✂️ Applying crop (PREVIEW ONLY):', cropArea)
      const pageIndex = editingPageIndex
      const page = pages[pageIndex]

      // Get the current rendered canvas
      const displayCanvas = canvasRef.current
      if (!displayCanvas) {
        console.error('❌ Display canvas not available')
        return
      }

      if (cropArea.width < 10 || cropArea.height < 10) {
        console.warn('Crop area too small')
        return
      }

      // DELEGATED: Step 1 - Normalize crop bounds using cropHandler
      const normalizedBounds = cropHandler.normalizeCropBounds(
        cropArea,
        displayCanvas.width,
        displayCanvas.height
      )
      
      if (!normalizedBounds.isValid) {
        console.warn('⚠️ Normalized crop area too small after boundary adjustment')
        return
      }
      
      const { x: cropX, y: cropY, width: cropWidth, height: cropHeight } = normalizedBounds

      const croppedCanvas = document.createElement('canvas')
      croppedCanvas.width = cropWidth
      croppedCanvas.height = cropHeight
      const croppedCtx = croppedCanvas.getContext('2d')
      
      croppedCtx.drawImage(
        displayCanvas,
        cropX, cropY, cropWidth, cropHeight,
        0, 0, cropWidth, cropHeight
      )

      // Step 2: Create final canvas for preview
      const finalCanvas = document.createElement('canvas')
      finalCanvas.width = displayCanvas.width
      finalCanvas.height = displayCanvas.height
      const finalCtx = finalCanvas.getContext('2d')

      // Fill with white background
      finalCtx.fillStyle = 'white'
      finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)

      // CENTER the cropped content on the page using shared helper
      const fitToPage = settings.fitCropToPage || false
      const drawParams = computeCenteredCropDrawParams(finalCanvas.width, finalCanvas.height, cropWidth, cropHeight, fitToPage)
      finalCtx.drawImage(croppedCanvas, drawParams.drawX, drawParams.drawY, drawParams.drawWidth, drawParams.drawHeight)
      
      console.log(`📐 Crop preview: cropped region (${cropWidth}×${cropHeight}) centered at (${drawParams.drawX.toFixed(1)}, ${drawParams.drawY.toFixed(1)})${fitToPage ? ' [FIT TO PAGE]' : ''}`)

      // DELEGATED: Step 3 - Store crop information using cropHandler
      const normalizedCropArea = cropHandler.createNormalizedCropArea(
        { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
        displayCanvas.width,
        displayCanvas.height
      )

      // Store in TEMPORARY preview state - NOT saved to pages yet
      // This will only be saved when Apply Changes or Apply to All is clicked
      // IMPORTANT: Store contentCanvas separately for proper rotation handling
      setPendingCropPreview({
        canvas: finalCanvas,
        contentCanvas: croppedCanvas,  // Raw cropped content (no centering)
        contentWidth: cropWidth,
        contentHeight: cropHeight,
        width: displayCanvas.width,
        height: displayCanvas.height,
        thumbnail: generateThumbnail(finalCanvas, 0.5, 0.6),
        cropArea: normalizedCropArea,
        settings: { ...settings },
        fitCropToPage: fitToPage,
        pageIndex: pageIndex,
        isRestoredFromSave: false  // New crop - unsaved changes
      })
      
      console.log('✅ Crop stored in PREVIEW state (not saved yet - click Apply Changes to save)')

      setCropMode(false)
      setCropArea(null)

      // Update the canvas immediately for visual preview
      requestAnimationFrame(() => {
        if (canvasRef.current) {
          const canvas = canvasRef.current
          const ctx = canvas.getContext('2d')
          canvas.width = finalCanvas.width
          canvas.height = finalCanvas.height
          ctx.drawImage(finalCanvas, 0, 0)
          
          setTimeout(() => {
            updateImageRect()
            console.log('✅ ImageRect recalculated after crop preview')
          }, 50)
        }
      })

    } catch (error) {
      console.error('❌ Error applying crop:', error)
    }
  }

  /**
   * Helper function to rotate a canvas by a specific angle
   * NOW DELEGATED TO: rotationHandler.rotateCanvas (extracted to pdf2/ui/rotationHandler.ts)
   */
  const rotateCanvas = (sourceCanvas, deltaRotation) => {
    return rotationHandler.rotateCanvas(sourceCanvas, deltaRotation)
  }

  /**
   * Reset all settings to defaults
   * NOW USES: cropHandler.calculateResetRotationDelta for rotation calculations (extracted to pdf2/ui/cropHandler.ts)
   */
  const resetSettings = () => {
    // If there's a pending crop preview, rotate it back to 0°
    if (pendingCropPreview && pendingCropPreview.settings.rotation !== 0) {
      const currentRotation = pendingCropPreview.settings.rotation
      // DELEGATED: Calculate rotation needed to get back to 0° using cropHandler
      const deltaRotation = cropHandler.calculateResetRotationDelta(currentRotation)
      
      console.log(`🔄 Resetting: rotating pending crop preview by ${deltaRotation}° (from ${currentRotation}° to 0°)`)
      
      // Use the content canvas (not the page-sized one) for rotation
      const sourceContentCanvas = pendingCropPreview.contentCanvas || pendingCropPreview.canvas
      const rotatedContentCanvas = rotateCanvas(sourceContentCanvas, deltaRotation)
      
      // Get target page size
      const targetPageSize = getOrientationAwarePageSize(currentPageSize)
      
      // Create final canvas at target page size
      const finalCanvas = document.createElement('canvas')
      finalCanvas.width = targetPageSize.width
      finalCanvas.height = targetPageSize.height
      const finalCtx = finalCanvas.getContext('2d')
      
      // Fill with white background
      finalCtx.fillStyle = 'white'
      finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)
      
      // Center the rotated content within the target page size
      const fitToPage = pendingCropPreview.fitCropToPage || settings.fitCropToPage || false
      const drawParams = computeCenteredCropDrawParams(
        finalCanvas.width, finalCanvas.height, 
        rotatedContentCanvas.width, rotatedContentCanvas.height, 
        fitToPage
      )
      finalCtx.drawImage(rotatedContentCanvas, drawParams.drawX, drawParams.drawY, drawParams.drawWidth, drawParams.drawHeight)
      
      setPendingCropPreview({
        ...pendingCropPreview,
        canvas: finalCanvas,
        contentCanvas: rotatedContentCanvas,  // Update content canvas
        contentWidth: rotatedContentCanvas.width,
        contentHeight: rotatedContentCanvas.height,
        width: finalCanvas.width,
        height: finalCanvas.height,
        thumbnail: generateThumbnail(finalCanvas, 0.5, 0.6),
        isRestoredFromSave: false,  // User made changes - now unsaved
        settings: {
          ...pendingCropPreview.settings,
          rotation: 0,
          scale: 100,
          offsetX: 0,
          offsetY: 0
        }
      })
      
      // Update the display canvas immediately
      requestAnimationFrame(() => {
        if (canvasRef.current) {
          const canvas = canvasRef.current
          const ctx = canvas.getContext('2d')
          canvas.width = finalCanvas.width
          canvas.height = finalCanvas.height
          ctx.drawImage(finalCanvas, 0, 0)
          
          setTimeout(() => {
            updateImageRect()
          }, 50)
        }
      })
    }
    
    setSettings({
      rotation: 0,
      scale: 100,
      offsetX: 0,
      offsetY: 0
    })
    setUserScale(100)
  }

  /**
   * Handle rotation changes with automatic crop remapping
   * NOW USES: cropHandler.calculateNewRotation for rotation calculations (extracted to pdf2/ui/cropHandler.ts)
   */
  const handleRotationChange = (deltaRotation) => {
    // If there's a pending crop preview, rotate the cropped content
    if (pendingCropPreview) {
      console.log(`🔄 Rotating pending crop preview by ${deltaRotation}°`)
      
      // Use the raw content canvas (not the page-sized one) for rotation
      // If contentCanvas exists, use it; otherwise fall back to extracting from canvas
      const sourceContentCanvas = pendingCropPreview.contentCanvas || pendingCropPreview.canvas
      const oldRotation = pendingCropPreview.settings.rotation
      // DELEGATED: Calculate new rotation using cropHandler
      const newRotation = cropHandler.calculateNewRotation(oldRotation, deltaRotation)
      
      // Rotate the CONTENT canvas (not the page canvas)
      const rotatedContentCanvas = rotateCanvas(sourceContentCanvas, deltaRotation)
      
      console.log(`📐 Content rotated: ${sourceContentCanvas.width}x${sourceContentCanvas.height} → ${rotatedContentCanvas.width}x${rotatedContentCanvas.height}`)
      
      // Get target page size - this should always stay the same (e.g., A4 landscape)
      const targetPageSize = getOrientationAwarePageSize(currentPageSize)
      
      // Create final canvas at target page size
      const finalCanvas = document.createElement('canvas')
      finalCanvas.width = targetPageSize.width
      finalCanvas.height = targetPageSize.height
      const finalCtx = finalCanvas.getContext('2d')
      
      // Fill with white background
      finalCtx.fillStyle = 'white'
      finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)
      
      // Center the rotated content within the target page size
      const fitToPage = pendingCropPreview.fitCropToPage || settings.fitCropToPage || false
      const drawParams = computeCenteredCropDrawParams(
        finalCanvas.width, finalCanvas.height, 
        rotatedContentCanvas.width, rotatedContentCanvas.height, 
        fitToPage
      )
      finalCtx.drawImage(rotatedContentCanvas, drawParams.drawX, drawParams.drawY, drawParams.drawWidth, drawParams.drawHeight)
      
      console.log(`📐 Final canvas: ${finalCanvas.width}x${finalCanvas.height}, Content: ${rotatedContentCanvas.width}x${rotatedContentCanvas.height}`)
      
      // Update pending crop preview - store rotated content as new contentCanvas
      // Clear isRestoredFromSave since user is making changes
      setPendingCropPreview({
        ...pendingCropPreview,
        canvas: finalCanvas,
        contentCanvas: rotatedContentCanvas,  // Update content canvas to rotated version
        contentWidth: rotatedContentCanvas.width,
        contentHeight: rotatedContentCanvas.height,
        width: finalCanvas.width,
        height: finalCanvas.height,
        thumbnail: generateThumbnail(finalCanvas, 0.5, 0.6),
        isRestoredFromSave: false,  // User made changes - now unsaved
        settings: {
          ...pendingCropPreview.settings,
          rotation: newRotation
        }
      })
      
      // Update the display canvas immediately - maintaining page dimensions
      requestAnimationFrame(() => {
        if (canvasRef.current) {
          const canvas = canvasRef.current
          const ctx = canvas.getContext('2d')
          canvas.width = finalCanvas.width
          canvas.height = finalCanvas.height
          ctx.drawImage(finalCanvas, 0, 0)
          
          setTimeout(() => {
            updateImageRect()
            console.log('✅ ImageRect recalculated after crop rotation')
          }, 50)
        }
      })
      
      // Update settings to match
      setSettings(prev => ({ ...prev, rotation: newRotation }))
      return
    }
    
    setSettings(prev => {
      const oldRotation = prev.rotation
      // DELEGATED: Calculate new rotation using cropHandler
      const newRotation = cropHandler.calculateNewRotation(prev.rotation, deltaRotation)
      
      // If no crop overlay, just update rotation
      if (!cropArea) {
        return { ...prev, rotation: newRotation }
      }
      
      // Crop overlay exists - remap it from old rotation space to new rotation space
      console.log(`🔄 Remapping crop from ${oldRotation}° to ${newRotation}°`)
      const remappedCrop = remapCropBetweenRotations(cropArea, oldRotation, newRotation)
      
      console.log('🔄 Crop remapped:', {
        oldRotation,
        newRotation,
        oldCrop: cropArea,
        newCrop: remappedCrop
      })
      
      // Update crop area state
      setCropArea(remappedCrop)
      
      return { ...prev, rotation: newRotation }
    })
  }

  const applyToAllPages = () => {
    console.info('[ApplyAll] 🚨 applyToAllPages clicked - showing modal 🚨')
    setShowApplyWarning(true)
  }

  const confirmApplyToAll = async () => {
    console.info('[ApplyAll] ⭐⭐⭐ confirmApplyToAll START ⭐⭐⭐', Date.now())
    
    // Start animation at 0% immediately for instant response
    setIsApplyingAll(true)
    setApplyAllProgress(0)
    
    // CRITICAL: Let React render the UI update BEFORE doing any processing
    // This ensures the user sees the animation start immediately
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => requestAnimationFrame(resolve))

    try {
      console.log('🔄 Apply All: Applying to loaded pages')
      
      // Get current page's crop info to apply universally
      // Check pendingCropPreview first (preview-only crop), then fall back to saved cropInfo
      const currentPageCropInfo = pendingCropPreview?.cropArea || pages[editingPageIndex]?.cropInfo
      
      // Clear pending crop preview since we're applying it now
      if (pendingCropPreview) {
        console.log('✅ Using pending crop preview for Apply All')
        setPendingCropPreview(null)
      }
      
      // Store settings for lazy-loaded pages (for pages that will load later)
      applyAllSettingsRef.current = {
        settings: { ...settings },
        userScale,
        currentPageSize,
        cropInfo: currentPageCropInfo
      }
      console.log('💾 Stored Apply All settings for future-loaded pages')
      
      // Helper to update progress
      const updateProgress = (progress) => {
        setApplyAllProgress(progress)
      }
      
      // Show initial progress
      updateProgress(0.05) // 5% - started
      await new Promise(resolve => requestAnimationFrame(resolve))
      
      updateProgress(0.1) // 10% - gathered state

      // Get target page size dimensions with correct orientation
      const targetPageSize = getOrientationAwarePageSize(currentPageSize)
      
      // Process currently loaded pages
      const totalPagesCount = pdf?.numPages || allPages.length
      console.log(`📄 Processing ${originalPages.length} loaded pages (out of ${totalPagesCount} total)`)
      console.log(`⚡ Unloaded pages will get settings when they're viewed`)
      console.log(`📋 Loaded page numbers:`, originalPages.map(p => p.pageNumber).join(', '))
      
      // For loaded pages: apply settings immediately
      const processedPages = []
      const totalPages = originalPages.length
      
      for (let index = 0; index < originalPages.length; index++) {
      const originalPage = originalPages[index]
      console.log(`📄 Applying settings to loaded page ${originalPage.pageNumber}`)
      
      // Update progress (10% to 70% range based on page processing)
      const pageProgress = 0.1 + (index / totalPages) * 0.6
      updateProgress(pageProgress)
      if (index % 5 === 0) { // Update UI every 5 pages for performance
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
      
      // Create fresh canvas for this page
      const pageCanvas = document.createElement('canvas')
      const pageCtx = pageCanvas.getContext('2d', { alpha: false, willReadFrequently: false })
      pageCtx.imageSmoothingEnabled = true
      pageCtx.imageSmoothingQuality = 'medium'
      
      // Use target page size dimensions
      pageCanvas.width = targetPageSize.width
      pageCanvas.height = targetPageSize.height
      
      // White background
      pageCtx.fillStyle = 'white'
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      
      // Apply transformations
      pageCtx.save()
      pageCtx.translate(pageCanvas.width / 2, pageCanvas.height / 2)
      pageCtx.translate(settings.offsetX, settings.offsetY)

      // Apply rotation
      if (settings.rotation !== 0) {
        pageCtx.rotate((settings.rotation * Math.PI) / 180)
      }

      // Calculate scaling
      const normalizedRotation = ((settings.rotation % 360) + 360) % 360
      const isRotated90or270 = normalizedRotation === 90 || normalizedRotation === 270
      
      let scaleToFit
      if (isRotated90or270) {
        const scaleX = pageCanvas.width / originalPage.height
        const scaleY = pageCanvas.height / originalPage.width
        scaleToFit = Math.min(scaleX, scaleY)
      } else {
        const scaleX = pageCanvas.width / originalPage.width
        const scaleY = pageCanvas.height / originalPage.height
        scaleToFit = Math.min(scaleX, scaleY)
      }

      const contentScale = settings.scale / 100
      const finalScale = scaleToFit * contentScale
      
      // ALWAYS use pristine original - completely overwrites any previous edits
      const sourceCanvas = originalPage.pristineOriginal || originalPage.originalCanvas || originalPage.canvas
      const drawWidth = originalPage.width * finalScale
      const drawHeight = originalPage.height * finalScale
      
      pageCtx.drawImage(sourceCanvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
      pageCtx.restore()

      // Apply crop if exists (universal - same crop to all pages)
      let finalCanvas = pageCanvas
      if (currentPageCropInfo) {
        console.log(`✂️ Applying universal crop to page ${index + 1}`)
        
        const cropX = Math.round(currentPageCropInfo.x * pageCanvas.width)
        const cropY = Math.round(currentPageCropInfo.y * pageCanvas.height)
        const cropWidth = Math.round(currentPageCropInfo.width * pageCanvas.width)
        const cropHeight = Math.round(currentPageCropInfo.height * pageCanvas.height)
        
        // Extract cropped region
        const croppedCanvas = document.createElement('canvas')
        croppedCanvas.width = cropWidth
        croppedCanvas.height = cropHeight
        const croppedCtx = croppedCanvas.getContext('2d')
        croppedCtx.drawImage(pageCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
        
        // Create final canvas at ORIGINAL page dimensions (keep page size unchanged)
        finalCanvas = document.createElement('canvas')
        finalCanvas.width = targetPageSize.width  // Keep original page width
        finalCanvas.height = targetPageSize.height  // Keep original page height
        const finalCtx = finalCanvas.getContext('2d')
        
        // Fill with white background
        finalCtx.fillStyle = 'white'
        finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)
        
        // CENTER the cropped content on the page using shared helper
        const fitToPage = settings.fitCropToPage || false
        const drawParams = computeCenteredCropDrawParams(finalCanvas.width, finalCanvas.height, cropWidth, cropHeight, fitToPage)
        finalCtx.drawImage(croppedCanvas, drawParams.drawX, drawParams.drawY, drawParams.drawWidth, drawParams.drawHeight)
        
        console.log(`  📐 Canvas save crop: centered at (${drawParams.drawX.toFixed(1)}, ${drawParams.drawY.toFixed(1)}) with size ${drawParams.drawWidth.toFixed(1)}×${drawParams.drawHeight.toFixed(1)}${fitToPage ? ' [FIT TO PAGE]' : ''}`)
      }

      // Apply color mode filter
      if (colorMode === 'BW') {
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = finalCanvas.width
        tempCanvas.height = finalCanvas.height
        const tempCtx = tempCanvas.getContext('2d')
        tempCtx.filter = 'grayscale(100%)'
        tempCtx.drawImage(finalCanvas, 0, 0)
        finalCanvas = document.createElement('canvas')
        finalCanvas.width = tempCanvas.width
        finalCanvas.height = tempCanvas.height
        const finalCtx = finalCanvas.getContext('2d')
        finalCtx.fillStyle = 'white'
        finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)
        finalCtx.drawImage(tempCanvas, 0, 0)
      }
      
      // Add completely fresh page - all previous edits overwritten
      // CRITICAL: Preserve pristineOriginal for subsequent Apply All operations
      processedPages.push({
        ...originalPage,
        canvas: finalCanvas,
        thumbnail: generateThumbnail(finalCanvas, 0.5, 0.6), // Use helper for consistent thumbnails
        edited: true,
        cropInfo: currentPageCropInfo, // Same crop for all (or undefined if no crop)
        pristineOriginal: originalPage.pristineOriginal || originalPage.originalCanvas || originalPage.canvas, // ⭐ PRESERVE for next Apply All
        editHistory: {
          rotation: settings.rotation,    // KEEP for pdf-lib export
          scale: settings.scale,          // KEEP for pdf-lib export
          offsetX: settings.offsetX,      // KEEP for pdf-lib export
          offsetY: settings.offsetY,      // KEEP for pdf-lib export
          cropArea: currentPageCropInfo,  // Use the actual crop info (normalized coordinates)
          fitCropToPage: settings.fitCropToPage || false  // ✅ Store fit-to-page preference
        }
      })
    }
    
    // Processing complete (70% progress)
    updateProgress(0.7)
    await new Promise(resolve => requestAnimationFrame(resolve))
    
    // N-up sheet regeneration progress (70% to 90%)
    updateProgress(0.9)
    await new Promise(resolve => requestAnimationFrame(resolve))
    
    // Handle N-up mode: regenerate sheets from processed pages
    if (pagesPerSheet === 2) {
      console.log('📄 Regenerating N-up sheets from processed pages')
      const processedSheets = []
      for (let i = 0; i < processedPages.length; i += 2) {
        const page1 = processedPages[i]
        const page2 = processedPages[i + 1]

        const filtered1 = applyColorFilter(page1.canvas, colorMode)

        if (page2) {
          const filtered2 = applyColorFilter(page2.canvas, colorMode)
          const combinedCanvas = combineConsecutivePagesForGrid(filtered1, filtered2, getOrientationAwarePageSize(currentPageSize))

          processedSheets.push({
            pageNumber: `${page1.pageNumber}-${page2.pageNumber}`,
            canvas: combinedCanvas,
            originalCanvas: combinedCanvas,
            thumbnail: generateThumbnail(combinedCanvas, 0.5, 0.6), // Use helper for consistent thumbnails
            width: combinedCanvas.width,
            height: combinedCanvas.height,
            isSheet: true,
            containsPages: [page1.pageNumber, page2.pageNumber],
            edited: true
          })
        } else {
          processedSheets.push({
            ...page1,
            canvas: filtered1,
            width: filtered1.width,
            height: filtered1.height,
            thumbnail: generateThumbnail(filtered1, 0.5, 0.6), // Use helper for consistent thumbnails
            edited: true,
            isSheet: false
          })
        }
      }
      setPages(processedSheets)
      setOriginalPages(processedPages)
      
      // Sync to allPages
      setAllPages(prev => prev.map(placeholder => {
        const updatedSheet = processedSheets.find(s => {
          if (s.isSheet && s.containsPages) {
            return s.containsPages.includes(placeholder.pageNumber)
          }
          return s.pageNumber === placeholder.pageNumber
        })
        if (updatedSheet && updatedSheet.thumbnail) {
          return {
            ...placeholder,
            thumbnail: updatedSheet.thumbnail,
            isLoaded: true,
            edited: true
          }
        }
        return placeholder
      }))
    } else {
      // Normal mode: just update pages
      setOriginalPages(processedPages)
      setPages(processedPages)
      
      // Sync to allPages
      setAllPages(prev => prev.map(placeholder => {
        const updatedPage = processedPages.find(p => p.pageNumber === placeholder.pageNumber)
        if (updatedPage && updatedPage.thumbnail) {
          return {
            ...placeholder,
            thumbnail: updatedPage.thumbnail,
            isLoaded: true,
            edited: true
          }
        }
        return placeholder
      }))
    }
    
    // Create notification for all pages
    const editedPagesMap = {}
    processedPages.forEach(page => {
      editedPagesMap[page.pageNumber] = {
        thumbnail: page.thumbnail,
        edited: true,
        canvas: page.canvas
      }
    })
    
    // Notify components about updates
    const updateEvent = new CustomEvent('pdfEditorUpdate', {
      detail: { editedPages: editedPagesMap }
    })
    window.dispatchEvent(updateEvent)
    
    const genericUpdateEvent = new Event('fileUpdated')
    window.dispatchEvent(genericUpdateEvent)
    
      const unloadedPageCount = totalPagesCount - processedPages.length
      console.log('✅ Apply All Complete Summary:')
      console.log(`   📊 Total pages in PDF: ${totalPagesCount}`)
      console.log(`   ✅ Pages processed immediately: ${processedPages.length}`)
      console.log(`   ⏳ Pages will be processed when loaded: ${unloadedPageCount}`)
      console.log(`   📋 Processed page numbers:`, processedPages.map(p => p.pageNumber).join(', '))
      console.log(`   ⚙️  Settings applied:`, settings)
      
      // Complete animation (100%)
      updateProgress(1.0)
      await new Promise(resolve => requestAnimationFrame(resolve))
      
    } catch (error) {
      console.error('❌ Error in Apply All:', error)
    } finally {
      // Brief delay to show 100% completion
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Close modal and reset animation state
      setShowApplyWarning(false)
      setIsApplyingAll(false)
      setApplyAllProgress(0)
      
      // Mark that Apply to All was done - user needs to click Apply Changes to save
      setHasAppliedToAll(true)
      console.log('✅ Apply to All done - changes pending until Apply Changes is clicked')
    }
  }
  
  const clearAllEdits = async () => {
    console.log('🧹 Clearing all edits and resetting to original state...')
    
    try {
      // Reset internal state
      setPages(prevPages => 
        prevPages.map(page => {
          const originalCanvas = page.pristineOriginal || page.originalCanvas
          
          return {
            ...page,
            canvas: originalCanvas,
            thumbnail: page.originalThumbnail,
            edited: false,
            editHistory: {
              rotation: 0,
              scale: 100,
              offsetX: 0,
              offsetY: 0,
              cropArea: null
            }
          }
        })
      )
      
      setOriginalPages(prevPages => 
        prevPages.map(page => {
          const originalCanvas = page.pristineOriginal || page.originalCanvas
          
          return {
            ...page,
            canvas: originalCanvas,
            thumbnail: page.originalThumbnail,
            edited: false,
            editHistory: {
              rotation: 0,
              scale: 100,
              offsetX: 0,
              offsetY: 0,
              cropArea: null
            }
          }
        })
      )
      
      // Update allPages to reflect cleared state
      setAllPages(prevPages =>
        prevPages.map(page => {
          if (page.isLoaded) {
            return {
              ...page,
              edited: false
            }
          }
          return page
        })
      )
      
      // Reset current page settings
      setSettings({
        rotation: 0,
        scale: 100,
        offsetX: 0,
        offsetY: 0
      })
      setUserScale(100)
      
      // Clear crop mode and crop area
      setCropMode(false)
      setCropArea(null)
      
      // Clear the Apply All settings
      applyAllSettingsRef.current = null
      
      console.log('✅ All edits cleared, regenerating original PDF to force reload...')
      
      // Re-create the PDF with original pages to force thumbnail regeneration
      const arrayBuffer = await file.arrayBuffer()
      const pdfDoc = await PDFDocument.load(arrayBuffer)
      const pdfBytes = await pdfDoc.save()
      const newBlob = new Blob([pdfBytes], { type: 'application/pdf' })
      
      // Create a unique filename to force React to treat this as a completely new file
      const timestamp = Date.now()
      const originalName = file.name.replace(/\.pdf$/i, '')
      const clearedFile = new File([newBlob], `${originalName}_cleared_${timestamp}.pdf`, { 
        type: 'application/pdf',
        lastModified: timestamp
      })
      
      console.log('✅ Cleared PDF regenerated with new filename, triggering full reload')
      
      // Trigger custom event to signal page selector to reset completely
      const updateEvent = new CustomEvent('pdfCleared', {
        detail: { 
          cleared: true,
          originalFile: file.name,
          newFile: clearedFile.name,
          timestamp 
        }
      })
      window.dispatchEvent(updateEvent)
      
      // Pass the regenerated file to parent to force full reload
      if (onSave) {
        onSave(clearedFile)
      }
      
    } catch (error) {
      console.error('❌ Error clearing edits:', error)
    }
  }

  const hasUnsavedChanges = useCallback(() => {
    const currentPage = pages[editingPageIndex]
    const savedHistory = currentPage?.editHistory || {
      rotation: 0,
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      cropArea: null
    }
    
    const settingsChanged = 
      settings.rotation !== savedHistory.rotation ||
      settings.scale !== savedHistory.scale ||
      settings.offsetX !== savedHistory.offsetX ||
      settings.offsetY !== savedHistory.offsetY
    
    const cropChanged = cropMode || (cropArea !== null && cropArea !== savedHistory.cropArea)
    
    // Check if there's a pending crop preview that is NOT restored from saved state
    // If isRestoredFromSave is true, it means we just loaded an existing crop - not unsaved
    const hasPendingCrop = pendingCropPreview !== null && !pendingCropPreview.isRestoredFromSave
    
    // Check if Apply to All was done but not saved with Apply Changes
    const hasApplyAllPending = hasAppliedToAll
    
    return settingsChanged || cropChanged || hasPendingCrop || hasApplyAllPending
  }, [settings, cropMode, cropArea, pages, editingPageIndex, pendingCropPreview, hasAppliedToAll])

  const handleCloseAttempt = () => {
    // If Apply to All was done, auto-save and close (no popup)
    if (hasAppliedToAll) {
      console.log('🔄 Auto-saving Apply to All changes and closing editor')
      setHasAppliedToAll(false)
      applyAllChanges()  // This will save and close automatically
      return
    }
    
    if (hasUnsavedChanges()) {
      setShowUnsavedChangesPopup(true)
    } else {
      performCloseEditPopup()
    }
  }

  const handleDiscardChanges = () => {
    setShowUnsavedChangesPopup(false)
    setPendingCropPreview(null)
    setHasAppliedToAll(false)
    performCloseEditPopup()
  }

  const handleSaveAndClose = () => {
    setShowUnsavedChangesPopup(false)
    applyAllChanges()
  }
  
  const applyAllChanges = async () => {
    // Start animation at 0% immediately
    setIsApplying(true)
    setApplyProgress(0)
    
    try {
      // Auto-apply any pending crop before saving
      if (cropMode && cropArea && !isDragging) {
        applyCrop()
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      
      // Process with progress tracking
      await finalizeSave()
      
    } catch (error) {
      console.error('❌ Error applying changes:', error)
      setIsApplying(false)
      setApplyProgress(0)
    }
  }

  const finalizeSave = async () => {
    // Capture state needed for processing
    const capturedState = {
      pageIndex: editingPageIndex,
      currentCanvas: canvasRef.current,
      pages: [...pages],
      originalPages: [...originalPages],
      settings: { ...settings },
      colorMode,
      pagesPerSheet,
      directPageEdit,
      pendingCropPreview: pendingCropPreview
    }
    
    console.log('⚡ Processing edits with progress tracking...')
    
    // Progress callback
    const updateProgress = (progress) => {
      setApplyProgress(progress)
    }
    
    try {
      // Process with progress updates - NO minimum duration
      await performFinalizeSave(capturedState, updateProgress)
      
      // Close editor immediately when done
      setShowEditPopup(false)
      setIsApplying(false)
      setApplyProgress(0)
      
      // Clear "Apply to All" pending state since changes are now saved
      setHasAppliedToAll(false)
      
      // For directPageEdit mode, call onCancel after processing completes
      if (capturedState.directPageEdit) {
        onCancel()
      }
    } catch (error) {
      console.error('❌ Error in save:', error)
      setShowEditPopup(false)
      setIsApplying(false)
      setApplyProgress(0)
      setHasAppliedToAll(false)
      if (capturedState.directPageEdit) {
        onCancel()
      }
    }
  }

  const performFinalizeSave = async (capturedState, updateProgress) => {
    // Destructure captured state
    const { pageIndex, currentCanvas, pages: capturedPages, originalPages: capturedOriginalPages, settings, colorMode, pagesPerSheet, directPageEdit, pendingCropPreview: capturedPendingCrop } = capturedState
    
    // Use mutable copies for pages that we'll update
    let pages = [...capturedPages]
    let originalPages = [...capturedOriginalPages]
    
    // Stage 1: Gather state and apply pending crop if exists (10% progress)
    updateProgress(0.1)
    await new Promise(resolve => requestAnimationFrame(resolve))
    
    // If there's a pending crop preview, save it to pages first
    if (capturedPendingCrop) {
      console.log('💾 Saving pending crop to pages...')
      const cropPageIndex = capturedPendingCrop.pageIndex
      const page = pages[cropPageIndex]
      
      if (page) {
        // Update the page with the cropped canvas and data
        // CRITICAL: Save contentCanvas so rotation/scale can work when reopening editor
        pages[cropPageIndex] = {
          ...page,
          canvas: capturedPendingCrop.canvas,
          width: capturedPendingCrop.width,
          height: capturedPendingCrop.height,
          thumbnail: capturedPendingCrop.thumbnail,
          edited: true,
          cropInfo: capturedPendingCrop.cropArea,
          editHistory: {
            ...page.editHistory,
            rotation: capturedPendingCrop.settings.rotation,
            scale: capturedPendingCrop.settings.scale,
            offsetX: capturedPendingCrop.settings.offsetX,
            offsetY: capturedPendingCrop.settings.offsetY,
            cropArea: capturedPendingCrop.cropArea,
            isCropped: true,
            fitCropToPage: capturedPendingCrop.fitCropToPage,
            contentCanvas: capturedPendingCrop.contentCanvas  // Save raw content for future editing
          }
        }
        
        // Also update originalPages for single pages
        if (!(pagesPerSheet === 2 && page.isSheet)) {
          const origIndex = pagesPerSheet === 2 
            ? originalPages.findIndex(p => p.pageNumber === page.pageNumber)
            : cropPageIndex
          
          if (origIndex >= 0 && origIndex < originalPages.length) {
            const origPage = originalPages[origIndex]
            originalPages[origIndex] = {
              ...origPage,
              canvas: capturedPendingCrop.canvas,
              width: capturedPendingCrop.width,
              height: capturedPendingCrop.height,
              thumbnail: capturedPendingCrop.thumbnail,
              edited: true,
              cropInfo: capturedPendingCrop.cropArea,
              editHistory: {
                ...origPage.editHistory,
                rotation: capturedPendingCrop.settings.rotation,
                scale: capturedPendingCrop.settings.scale,
                offsetX: capturedPendingCrop.settings.offsetX,
                offsetY: capturedPendingCrop.settings.offsetY,
                cropArea: capturedPendingCrop.cropArea,
                isCropped: true,
                fitCropToPage: capturedPendingCrop.fitCropToPage,
                contentCanvas: capturedPendingCrop.contentCanvas  // Save raw content for future editing
              }
            }
          }
        }
        
        console.log('✅ Pending crop saved to pages')
        
        // Update React state immediately with the pending crop changes
        setPages([...pages])
        setOriginalPages([...originalPages])
      }
      
      // Clear the pending crop preview state
      setPendingCropPreview(null)
    }
    
    if (currentCanvas && pages[pageIndex]) {
      // Create a new canvas to store the final edited state
      const finalCanvas = document.createElement('canvas')
      const finalCtx = finalCanvas.getContext('2d')
      finalCanvas.width = currentCanvas.width
      finalCanvas.height = currentCanvas.height
      finalCtx.drawImage(currentCanvas, 0, 0)

      // Determine which original pages are being edited
      let originalPageIndices = [pageIndex]
      const isSheet = pagesPerSheet === 2 && pages[pageIndex]?.isSheet

      if (isSheet) {
        // In 2-up mode, we're editing a sheet that contains 2 pages
        originalPageIndices = [
          pageIndex * 2,
          pageIndex * 2 + 1
        ].filter(idx => idx < originalPages.length)
      }

      // Update the originalPages array with edits
      // CRITICAL: Create a clean copy without carrying over old edited flags
      const updatedOriginalPages = originalPages.map(page => ({ ...page }))

      // Stage 2: Apply edits to pages (10% to 70% progress)
      const totalPages = originalPageIndices.length
      let processedPages = 0
      
      // Track if pending crop was applied (to skip re-processing that page)
      const pendingCropPageIndex = capturedPendingCrop?.pageIndex
      
      // Apply edits to ONLY the pages in the current view
      originalPageIndices.forEach((origIdx) => {
        const originalPage = originalPages[origIdx]
        
        // If this page had a pending crop applied, skip transformation processing
        // The cropped canvas already has all transformations baked in
        if (pendingCropPageIndex !== undefined && origIdx === pendingCropPageIndex && originalPage.editHistory?.isCropped) {
          console.log('✅ Skipping transformation for cropped page - crop already includes transforms')
          
          // Just update the editHistory and mark as edited, keep the cropped canvas
          updatedOriginalPages[origIdx] = {
            ...updatedOriginalPages[origIdx],
            edited: true
          }
          
          processedPages++
          const pageProgress = 0.1 + (0.6 * processedPages / totalPages)
          updateProgress(pageProgress)
          return
        }
        
        // For each page, create its own canvas with edits applied
        const pageCanvas = document.createElement('canvas')
        const pageCtx = pageCanvas.getContext('2d')

        // Keep original page dimensions (don't swap!)
        pageCanvas.width = originalPage.width
        pageCanvas.height = originalPage.height

        // Fill with white background
        pageCtx.fillStyle = 'white'
        pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)

        // Apply transformations to this specific page
        pageCtx.save()
        pageCtx.translate(pageCanvas.width / 2, pageCanvas.height / 2)
        pageCtx.translate(settings.offsetX, settings.offsetY)

        if (settings.rotation !== 0) {
          pageCtx.rotate((settings.rotation * Math.PI) / 180)
        }

        // ROTATION SCALING LOGIC - Same as main page
        const rotation = settings.rotation % 360
        const isRotated90or270 = rotation === 90 || rotation === 270
        
        let scaleToFit
        if (isRotated90or270) {
          // ALWAYS use Math.min to keep content within page boundaries
          const scaleX = pageCanvas.width / originalPage.height
          const scaleY = pageCanvas.height / originalPage.width
          scaleToFit = Math.min(scaleX, scaleY)
        } else {
          // Normal fit for non-rotated content
          const scaleX = pageCanvas.width / originalPage.width
          const scaleY = pageCanvas.height / originalPage.height
          scaleToFit = Math.min(scaleX, scaleY)
        }

        const contentScale = settings.scale / 100
        const finalScale = scaleToFit * contentScale
        
        // Choose source canvas based on CURRENT page's crop (not old cropInfo from Apply All)
        let sourceCanvas, sourceWidth, sourceHeight
        const currentPageCropInfo = pages[editingPageIndex]?.cropInfo
        if (currentPageCropInfo && originalPage.pageNumber === pages[editingPageIndex].pageNumber) {
          // Use cropped canvas ONLY if currently editing this page with active crop
          sourceCanvas = originalPage.canvas
          sourceWidth = originalPage.canvas.width
          sourceHeight = originalPage.canvas.height
          console.log('✂️ Using cropped canvas for save - crop is permanent')
        } else {
          // Use pristine original (prevents rotation/filter compounding, ignores old crops)
          sourceCanvas = originalPage.pristineOriginal || originalPage.originalCanvas || originalPage.canvas
          sourceWidth = originalPage.width
          sourceHeight = originalPage.height
        }
        
        const drawWidth = sourceWidth * finalScale
        const drawHeight = sourceHeight * finalScale
        pageCtx.drawImage(sourceCanvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
        pageCtx.restore()

        // Apply color mode filter - optimized using canvas filter
        if (colorMode === 'BW') {
          const tempCanvas = document.createElement('canvas')
          tempCanvas.width = pageCanvas.width
          tempCanvas.height = pageCanvas.height
          const tempCtx = tempCanvas.getContext('2d')
          tempCtx.filter = 'grayscale(100%)'
          tempCtx.drawImage(pageCanvas, 0, 0)
          pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height)
          pageCtx.fillStyle = 'white'
          pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
          pageCtx.drawImage(tempCanvas, 0, 0)
        }

        // Update canvas but PRESERVE pristineOriginal (NEVER modify it)
        // Use lower quality (0.4) for faster thumbnail generation
        updatedOriginalPages[origIdx] = {
          ...updatedOriginalPages[origIdx],
          canvas: pageCanvas,
          pristineOriginal: originalPage.pristineOriginal || originalPage.originalCanvas,  // KEEP pristine
          originalCanvas: originalPage.pristineOriginal || originalPage.originalCanvas,    // KEEP pristine
          width: originalPage.width,
          height: originalPage.height,
          thumbnail: pageCanvas.toDataURL('image/jpeg', 0.4), // Lower quality for faster generation
          edited: true,
          editHistory: {
            ...updatedOriginalPages[origIdx].editHistory,
            rotation: settings.rotation,    // KEEP for pdf-lib export
            scale: settings.scale,          // KEEP for pdf-lib export
            offsetX: settings.offsetX,      // KEEP for pdf-lib export
            offsetY: settings.offsetY,      // KEEP for pdf-lib export
            cropArea: updatedOriginalPages[origIdx].editHistory?.cropArea || null  // Preserve existing crop
          }
        }
        
        // Update progress per page
        processedPages++
        const pageProgress = 0.1 + (0.6 * processedPages / totalPages)
        updateProgress(pageProgress)
      })

      // Stage 3: Update state (70% progress)
      updateProgress(0.7)
      await new Promise(resolve => requestAnimationFrame(resolve))
      
      setOriginalPages(updatedOriginalPages)

      // CRITICAL: Build map of ONLY the pages edited in THIS session
      // Only include pages from originalPageIndices (the ones we just edited)
      const updatedPagesMap = new Map()
      originalPageIndices.forEach(origIdx => {
        const page = updatedOriginalPages[origIdx]
        if (page) {
          updatedPagesMap.set(page.pageNumber, page)
        }
      })

      // Stage 4: Regenerate sheets/pages (70% to 90% progress)
      updateProgress(0.75)
      await new Promise(resolve => requestAnimationFrame(resolve))
      
      // If in N-up mode, only update sheets that contain edited pages
      if (pagesPerSheet === 2) {
        // Keep existing pages array and only update the specific sheets that were edited
        setPages(prevPages => {
          return prevPages.map((sheet, sheetIndex) => {
            if (!sheet.isSheet) {
              // Single page sheet - check if it was updated
              const updatedPage = updatedPagesMap.get(sheet.pageNumber)
              if (updatedPage) {
                const filtered = applyColorFilter(updatedPage.canvas, colorMode)
                return {
                  ...updatedPage,
                  canvas: filtered,
                  thumbnail: filtered.toDataURL('image/jpeg', 0.4) // Lower quality for faster generation
                }
              }
              return sheet
            }

            // For 2-page sheets, check if either page was updated
            const page1Num = sheet.containsPages[0]
            const page2Num = sheet.containsPages[1]
            const page1 = updatedPagesMap.get(page1Num)
            const page2 = page2Num ? updatedPagesMap.get(page2Num) : null

            // If neither page was updated, keep the sheet as-is
            if (!page1 && !page2) {
              return sheet
            }

            // At least one page was updated - but we need BOTH pages to regenerate the sheet
            // Try to get both pages from updatedOriginalPages (the newly updated pages with edits)
            const actualPage1 = page1 || updatedOriginalPages.find(p => p.pageNumber === page1Num)
            const actualPage2 = page2 || (page2Num ? updatedOriginalPages.find(p => p.pageNumber === page2Num) : null)

            // If we don't have both pages loaded, keep the existing sheet unchanged
            // This prevents collapsing sheets when only one page is loaded
            if (!actualPage1 || (page2Num && !actualPage2)) {
              console.log(`⚠️ Cannot regenerate sheet ${page1Num}-${page2Num}: missing page data, keeping existing sheet`)
              return sheet
            }

            // We have complete data - regenerate this sheet
            const filtered1 = applyColorFilter(actualPage1.canvas, colorMode)

            if (actualPage2) {
              const filtered2 = applyColorFilter(actualPage2.canvas, colorMode)
              const combinedCanvas = combineConsecutivePagesForGrid(filtered1, filtered2, getOrientationAwarePageSize(currentPageSize))

              return {
                pageNumber: `${actualPage1.pageNumber}-${actualPage2.pageNumber}`,
                canvas: combinedCanvas,
                originalCanvas: combinedCanvas,
                thumbnail: combinedCanvas.toDataURL('image/jpeg', 0.4), // Lower quality for faster generation
                width: combinedCanvas.width,
                height: combinedCanvas.height,
                isSheet: true,
                containsPages: [actualPage1.pageNumber, actualPage2.pageNumber],
                edited: actualPage1.edited || actualPage2.edited
              }
            } else {
              return {
                ...actualPage1,
                canvas: filtered1,
                thumbnail: filtered1.toDataURL('image/jpeg', 0.6)
              }
            }
          })
        })
        
        // Sync only the updated page thumbnails to allPages
        // CRITICAL: Only mark as edited if in updatedPagesMap (edited THIS session)
        setAllPages(prev => prev.map(placeholder => {
          const updatedPage = updatedPagesMap.get(placeholder.pageNumber)
          if (updatedPage) {
            return {
              ...placeholder,
              thumbnail: updatedPage.thumbnail || placeholder.thumbnail,
              isLoaded: true,
              edited: true  // Only these pages edited in THIS session
            }
          }
          return placeholder  // Other pages keep their current state
        }))
      } else {
        // In normal mode, only update the specific pages that were edited
        setPages(prevPages => {
          return prevPages.map(page => {
            const updatedPage = updatedPagesMap.get(page.pageNumber)
            if (updatedPage) {
              const filtered = applyColorFilter(updatedPage.canvas, colorMode)
              return {
                ...updatedPage,
                canvas: filtered,
                thumbnail: filtered.toDataURL('image/jpeg', 0.6)
              }
            }
            return page
          })
        })
        
        // Sync only the updated page thumbnails to allPages
        // CRITICAL: Only mark as edited if in updatedPagesMap (edited THIS session)
        setAllPages(prev => prev.map(placeholder => {
          const updatedPage = updatedPagesMap.get(placeholder.pageNumber)
          if (updatedPage) {
            return {
              ...placeholder,
              thumbnail: updatedPage.thumbnail || placeholder.thumbnail,
              isLoaded: true,
              edited: true  // Only these pages edited in THIS session
            }
          }
          return placeholder  // Other pages keep their current state
        }))
      }
      
      // Stage 5: Complete (100% progress)
      updateProgress(1.0)
      await new Promise(resolve => requestAnimationFrame(resolve))
      
      // Handle direct page edit mode
      if (directPageEdit && onSave) {
        const createUpdatedPDF = async () => {
          try {
            console.log(`📄 Creating updated PDF for direct page edit mode with ${allPages.length} total pages...`)
            
            // Create a map of edited pages by page number for quick lookup
            const editedPagesMap = new Map()
            updatedOriginalPages.forEach(page => {
              if (page.edited) {
                editedPagesMap.set(page.pageNumber, page)
              }
            })
            
            console.log(`📝 Found ${editedPagesMap.size} edited pages in loaded pages`)
            
            // CRITICAL: Check if "Apply All" was used
            // If so, we need to apply settings to ALL pages, not just loaded ones
            const hasApplyAllSettings = applyAllSettingsRef.current !== null
            if (hasApplyAllSettings) {
              console.log(`⚡ "Apply All" was used - will apply settings to ALL ${allPages.length} pages`)
            }
            
            // If NO pages were edited AND no "Apply All" settings, just return the original file
            if (editedPagesMap.size === 0 && !hasApplyAllSettings) {
              console.log('✅ No edits detected, returning original PDF')
              onSave(file)
              return
            }
            
            // Load the original PDF and modify it in-place
            const arrayBuffer = await file.arrayBuffer()
            const pdfDoc = await PDFDocument.load(arrayBuffer)
            
            console.log(`🔧 Applying transformations (canvas for crop, metadata for others)`)
            
            // Separate pages that need canvas recomposition vs metadata-only
            // Canvas recomposition needed for: crop, rotation, scale, or offset
            const recomposedPages = new Map()  // Pages needing form XObject redraw
            const metadataOnlyPages = new Map()  // Truly untouched pages
            
            // Add already-loaded edited pages
            for (const [pageNum, editedPage] of editedPagesMap.entries()) {
              const history = editedPage.editHistory
              // Check if page needs canvas recomposition (ONLY crop - rotation and scale use metadata)
              const needsRecomposition = history?.cropArea
              
              console.log(`🔍 Page ${pageNum} categorization:`, {
                hasCrop: !!history?.cropArea,
                hasRotation: !!history?.rotation,
                hasScale: !!history?.scale,
                needsRecomposition,
                willUse: needsRecomposition ? 'CANVAS (image)' : 'METADATA (vector)'
              })
              
              if (needsRecomposition) {
                recomposedPages.set(pageNum, editedPage)
              } else {
                metadataOnlyPages.set(pageNum, editedPage)
              }
            }
            
            // CRITICAL: If "Apply All" was used, apply settings to ALL remaining pages
            if (hasApplyAllSettings) {
              const totalPages = pdfDoc.getPageCount()
              const storedSettings = applyAllSettingsRef.current
              const { cropInfo } = storedSettings
              
              console.log(`⚡ Applying "Apply All" settings to ${totalPages - editedPagesMap.size} unloaded pages...`)
              
              for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                // Skip pages that are already in editedPagesMap (already processed)
                if (editedPagesMap.has(pageNum)) {
                  continue
                }
                
                // Create a virtual page with the stored editHistory
                const virtualPage = {
                  pageNumber: pageNum,
                  editHistory: {
                    ...storedSettings.settings,
                    cropArea: cropInfo || null
                  }
                }
                
                // Check if page needs canvas recomposition (ONLY crop - rotation and scale use metadata)
                const needsRecomposition = cropInfo
                
                if (needsRecomposition) {
                  recomposedPages.set(pageNum, virtualPage)
                } else {
                  metadataOnlyPages.set(pageNum, virtualPage)
                }
              }
              
              console.log(`✅ Added ${totalPages - editedPagesMap.size} pages from "Apply All" settings`)
            }
            
            console.log(`📊 All pages will use VECTOR-BASED transformations (no rasterization)`)
            
            // Combine all pages for vector processing
            const allTransformedPages = new Map([...recomposedPages, ...metadataOnlyPages])
            
            // Apply ALL transformations using vector-preserving methods (including crop)
            for (const [pageNum, editedPage] of allTransformedPages.entries()) {
              const pageIndex = pageNum - 1
              const srcPage = pdfDoc.getPage(pageIndex)
              const { width, height } = srcPage.getSize()
              const history = editedPage.editHistory
              
              if (!history) continue
              
              const hasCrop = !!history.cropArea
              const hasRotation = !!history.rotation
              const hasScale = history.scale && history.scale !== 100
              
              console.log(`📝 Processing page ${pageNum} with VECTORS:`, {
                hasCrop,
                hasRotation,
                hasScale
              })
              
              // Use CANONICAL transformation helper (robust for all edit combinations)
              const transform = buildCanonicalTransform(
                { width, height },
                { width, height },
                history
              )
              
              // Embed source page as Form XObject (preserves vectors!)
              const [embeddedPage] = await pdfDoc.embedPages([srcPage])
              
              // Replace page
              pdfDoc.removePage(pageIndex)
              const newPage = pdfDoc.insertPage(pageIndex, [width, height])
              
              // White background
              newPage.drawRectangle({
                x: 0,
                y: 0,
                width: width,
                height: height,
                color: { type: 'RGB', red: 1, green: 1, blue: 1 }
              })
              
              // Apply transformations using graphics state and operators
              newPage.pushOperators(pushGraphicsState())
              
              // Get crop coordinates in PDF space
              const cropX = transform.sourceRect.x
              const pdfCropY = height - transform.sourceRect.y - transform.sourceRect.height
              const cropWidth = transform.sourceRect.width
              const cropHeight = transform.sourceRect.height
              
              // Step 1: Center the crop on the page
              const centerOffsetX = (width - cropWidth) / 2
              const centerOffsetY = (height - cropHeight) / 2
              newPage.pushOperators(
                concatTransformationMatrix(1, 0, 0, 1, centerOffsetX, centerOffsetY)
              )
              
              // Step 2: Apply rotation and scale
              if (hasRotation || hasScale) {
                const rotation = history.rotation || 0
                const radians = (-rotation * Math.PI) / 180
                const cos = Math.cos(radians)
                const sin = Math.sin(radians)
                const scale = transform.finalScale
                
                const centerX = cropWidth / 2
                const centerY = cropHeight / 2
                
                newPage.pushOperators(
                  concatTransformationMatrix(1, 0, 0, 1, centerX, centerY)
                )
                
                newPage.pushOperators(
                  concatTransformationMatrix(
                    scale * cos, scale * sin, -scale * sin, scale * cos, 0, 0
                  )
                )
                
                newPage.pushOperators(
                  concatTransformationMatrix(1, 0, 0, 1, -centerX, -centerY)
                )
                
                console.log(`  ↻ Applied rotation ${rotation}° and scale ${scale.toFixed(3)}x (VECTOR)`)
              }
              
              // Step 3: Apply clipping (vector-based!)
              if (hasCrop) {
                newPage.pushOperators(
                  moveTo(0, 0),
                  lineTo(cropWidth, 0),
                  lineTo(cropWidth, cropHeight),
                  lineTo(0, cropHeight),
                  closePath(),
                  clip(),
                  endPath()
                )
                console.log(`  ✂️ Crop applied (VECTOR clip, no rasterization)`)
              }
              
              // Step 4: Draw the embedded page (vectors preserved!)
              const drawX = -cropX
              const drawY = -pdfCropY
              
              newPage.drawPage(embeddedPage, {
                x: drawX,
                y: drawY,
                width: width,
                height: height
              })
              
              newPage.pushOperators(popGraphicsState())
              
              console.log(`  ✅ Page transformed - ALL VECTORS PRESERVED!`)
            }
            
            console.log(`✅ Export complete: ${allTransformedPages.size} pages - ZERO rasterization!`)

            const pdfBytes = await pdfDoc.save()
            const editedFile = new File([pdfBytes], file.name, { type: 'application/pdf' })

            console.log('✅ PDF created successfully, saving...')
            onSave(editedFile)

          } catch (error) {
            console.error('❌ Error creating updated PDF:', error)
            onCancel()
          }
        }
        
        createUpdatedPDF()
        return
      }

      // For regular mode, notify PDFPageSelector about the updates
      // CRITICAL: Only include pages that were ACTUALLY edited in this session
      const editedPagesMap = {}
      originalPageIndices.forEach(origIdx => {
        const page = updatedOriginalPages[origIdx]
        if (page && page.edited) {
          editedPagesMap[page.pageNumber] = {
            thumbnail: page.thumbnail,
            edited: true,
            canvas: page.canvas
          }
        }
      })

      console.log(`📢 Preparing vector-based finalPDF for ${Object.keys(editedPagesMap).length} edited pages`)

      // CRITICAL: Export vector-based finalPDF (same logic as directPageEdit mode)
      let finalPDF = null
      try {
        const editedPagesMapForExport = new Map()
        updatedOriginalPages.forEach(page => {
          if (page.edited) {
            editedPagesMapForExport.set(page.pageNumber, page)
          }
        })
        
        const hasApplyAllSettings = applyAllSettingsRef.current !== null
        
        // Only export if there are edits
        if (editedPagesMapForExport.size > 0 || hasApplyAllSettings) {
          const arrayBuffer = await file.arrayBuffer()
          const pdfDoc = await PDFDocument.load(arrayBuffer)
          
          console.log(`🔧 Exporting ${editedPagesMapForExport.size} edited pages using VECTOR methods`)
          
          // Combine all pages for vector processing
          const allTransformedPages = new Map()
          
          // Add already-loaded edited pages
          for (const [pageNum, editedPage] of editedPagesMapForExport.entries()) {
            allTransformedPages.set(pageNum, editedPage)
          }
          
          // If "Apply All" was used, add settings for unloaded pages
          if (hasApplyAllSettings) {
            const totalPages = pdfDoc.getPageCount()
            const storedSettings = applyAllSettingsRef.current
            
            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
              if (!editedPagesMapForExport.has(pageNum)) {
                allTransformedPages.set(pageNum, {
                  pageNumber: pageNum,
                  editHistory: {
                    ...storedSettings.settings,
                    cropArea: storedSettings.cropInfo || null
                  }
                })
              }
            }
          }
          
          // Apply ALL transformations using vector-preserving methods
          for (const [pageNum, editedPage] of allTransformedPages.entries()) {
            const pageIndex = pageNum - 1
            const srcPage = pdfDoc.getPage(pageIndex)
            const { width, height } = srcPage.getSize()
            const history = editedPage.editHistory
            
            if (!history) continue
            
            const hasCrop = !!history.cropArea
            const hasRotation = !!history.rotation
            const hasScale = history.scale && history.scale !== 100
            
            if (!hasCrop && !hasRotation && !hasScale) continue
            
            // Use CANONICAL transformation helper (robust for all edit combinations)
            const transform = buildCanonicalTransform(
              { width, height },
              { width, height },
              history
            )
            
            // Embed source page as Form XObject (preserves vectors!)
            const [embeddedPage] = await pdfDoc.embedPages([srcPage])
            
            // Replace page
            pdfDoc.removePage(pageIndex)
            const newPage = pdfDoc.insertPage(pageIndex, [width, height])
            
            // White background
            newPage.drawRectangle({
              x: 0,
              y: 0,
              width: width,
              height: height,
              color: { type: 'RGB', red: 1, green: 1, blue: 1 }
            })
            
            // Apply transformations using graphics state and operators
            newPage.pushOperators(pushGraphicsState())
            
            // Get crop coordinates in PDF space
            const cropX = transform.sourceRect.x
            const pdfCropY = height - transform.sourceRect.y - transform.sourceRect.height
            const cropWidth = transform.sourceRect.width
            const cropHeight = transform.sourceRect.height
            
            // Step 1: Center the crop on the page
            const centerOffsetX = (width - cropWidth) / 2
            const centerOffsetY = (height - cropHeight) / 2
            newPage.pushOperators(
              concatTransformationMatrix(1, 0, 0, 1, centerOffsetX, centerOffsetY)
            )
            
            // Step 2: Apply rotation and scale
            if (hasRotation || hasScale) {
              const rotation = history.rotation || 0
              const radians = (-rotation * Math.PI) / 180
              const cos = Math.cos(radians)
              const sin = Math.sin(radians)
              const scale = transform.finalScale
              
              const centerX = cropWidth / 2
              const centerY = cropHeight / 2
              
              newPage.pushOperators(
                concatTransformationMatrix(1, 0, 0, 1, centerX, centerY)
              )
              
              newPage.pushOperators(
                concatTransformationMatrix(
                  scale * cos, scale * sin, -scale * sin, scale * cos, 0, 0
                )
              )
              
              newPage.pushOperators(
                concatTransformationMatrix(1, 0, 0, 1, -centerX, -centerY)
              )
            }
            
            // Step 3: Apply clipping (vector-based!)
            if (hasCrop) {
              newPage.pushOperators(
                moveTo(0, 0),
                lineTo(cropWidth, 0),
                lineTo(cropWidth, cropHeight),
                lineTo(0, cropHeight),
                closePath(),
                clip(),
                endPath()
              )
            }
            
            // Step 4: Draw the embedded page (vectors preserved!)
            const drawX = -cropX
            const drawY = -pdfCropY
            
            newPage.drawPage(embeddedPage, {
              x: drawX,
              y: drawY,
              width: width,
              height: height
            })
            
            newPage.pushOperators(popGraphicsState())
          }
          
          const pdfBytes = await pdfDoc.save()
          finalPDF = new File([pdfBytes], file.name, { type: 'application/pdf' })
          
          console.log(`✅ Vector-based finalPDF exported successfully (ZERO rasterization!)`)
        }
      } catch (error) {
        console.error('❌ Error exporting finalPDF:', error)
        // Continue without finalPDF - OrderPage will regenerate if needed
      }

      const updateEvent = new CustomEvent('pdfEditorUpdate', {
        detail: { 
          editedPages: editedPagesMap,
          finalPDF: finalPDF || undefined
        }
      })
      window.dispatchEvent(updateEvent)
    }
    
    // Return successfully (onCancel will be called in finalizeSave's then block for directPageEdit)
  }

  const exportPDF = async () => {
    try {
      setLoading(true)
      
      // Initialize memory tracker if not exists
      if (!memoryTracker.current) {
        memoryTracker.current = createMemoryTracker('PDFEditor-Export')
      }
      memoryTracker.current.reset()
      memoryTracker.current.mark('🚀 Export PDF - START (Baseline)')
      
      console.log(`📄 Exporting PDF with ${allPages.length} total pages, ${originalPages.length} loaded`)
      
      // Create a map of edited pages by page number for quick lookup
      const editedPagesMap = new Map()
      originalPages.forEach(page => {
        if (page.edited && page.editHistory) {
          editedPagesMap.set(page.pageNumber, page)
        }
      })
      
      console.log(`📝 Found ${editedPagesMap.size} edited pages in loaded pages`)
      
      // CRITICAL: Check if "Apply All" was used
      const hasApplyAllSettings = applyAllSettingsRef.current !== null
      if (hasApplyAllSettings) {
        console.log(`⚡ "Apply All" was used - will apply settings to ALL ${allPages.length} pages`)
      }
      
      // If NO pages were edited AND no "Apply All" settings, just return the original file
      if (editedPagesMap.size === 0 && !hasApplyAllSettings) {
        console.log('✅ No edits detected, returning original PDF')
        
        // Notify PDFPageSelector (no edits)
        const updateEvent = new CustomEvent('pdfEditorUpdate', {
          detail: { 
            editedPages: {},
            finalPDF: file
          }
        })
        window.dispatchEvent(updateEvent)
        
        onSave(file)
        return
      }
      
      // Load the original PDF
      memoryTracker.current?.mark('📄 Before file.arrayBuffer()')
      const arrayBuffer = await file.arrayBuffer()
      memoryTracker.current?.mark(`📄 ArrayBuffer loaded (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`)
      
      memoryTracker.current?.mark('📚 Before pdf-lib PDFDocument.load()')
      const pdfDoc = await PDFDocument.load(arrayBuffer)
      memoryTracker.current?.mark(`📚 pdf-lib PDFDocument loaded (${pdfDoc.getPageCount()} pages)`)
      
      console.log(`🔧 Applying transformations (canvas for crop, metadata for others)`)
      
      // All pages use vector-preserving methods - no canvas rasterization
      const transformedPages = new Map()
      
      // Add already-loaded edited pages
      for (const [pageNum, editedPage] of editedPagesMap.entries()) {
        const history = editedPage.editHistory
        
        const hasCrop = !!history?.cropArea
        const hasRotation = !!history?.rotation
        const hasScale = history?.scale && history?.scale !== 100
        
        console.log(`🔍 Page ${pageNum}:`, {
          hasCrop,
          hasRotation,
          hasScale,
          method: 'VECTOR (transformation matrix + clipping)'
        })
        
        transformedPages.set(pageNum, editedPage)
      }
      
      // CRITICAL: If "Apply All" was used, apply settings to ALL remaining pages
      if (hasApplyAllSettings) {
        const totalPages = pdfDoc.getPageCount()
        const storedSettings = applyAllSettingsRef.current
        const { cropInfo } = storedSettings
        
        console.log(`⚡ Applying "Apply All" settings to ${totalPages - editedPagesMap.size} unloaded pages...`)
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          // Skip pages that are already in editedPagesMap (already processed)
          if (editedPagesMap.has(pageNum)) {
            continue
          }
          
          // Create a virtual page with the stored editHistory
          const virtualPage = {
            pageNumber: pageNum,
            editHistory: {
              ...storedSettings.settings,
              cropArea: cropInfo || null
            }
          }
          
          transformedPages.set(pageNum, virtualPage)
        }
        
        console.log(`✅ Added ${totalPages - editedPagesMap.size} pages from "Apply All" settings`)
      }
      
      console.log(`📊 Total transformed pages: ${transformedPages.size} (all using vector methods)`)
      memoryTracker.current?.mark(`🔄 Starting transformation loop (${transformedPages.size} pages)`)
      
      let processedCount = 0
      // Apply all transformations using vector-preserving methods
      for (const [pageNum, editedPage] of transformedPages.entries()) {
        const pageIndex = pageNum - 1
        const srcPage = pdfDoc.getPage(pageIndex)
        const { width, height} = srcPage.getSize()
        const history = editedPage.editHistory
        
        if (!history) continue
        
        const hasCrop = !!history.cropArea
        const hasRotation = !!history.rotation
        const hasScale = history.scale && history.scale !== 100
        
        console.log(`📝 Processing page ${pageNum}:`, {
          hasCrop,
          hasRotation,
          hasScale,
          method: 'Vector-preserving (transformation matrix + clipping)'
        })
        
        // Use CANONICAL transformation helper (robust for all edit combinations)
        const transform = buildCanonicalTransform(
          { width, height },
          { width, height },
          history
        )
        
        // Embed source page as Form XObject
        const [embeddedPage] = await pdfDoc.embedPages([srcPage])
        
        // Replace page
        pdfDoc.removePage(pageIndex)
        const newPage = pdfDoc.insertPage(pageIndex, [width, height])
        
        // White background
        newPage.drawRectangle({
          x: 0,
          y: 0,
          width: width,
          height: height,
          color: { type: 'RGB', red: 1, green: 1, blue: 1 }
        })
        
        // Apply transformations using graphics state and operators
        newPage.pushOperators(pushGraphicsState())
        
        // CRITICAL ORDER: Center crop → Rotate/Scale → Clip → Draw
        // This centers the cropped content on the page while preserving vectors
        
        // Get crop coordinates in PDF space (bottom-left origin)
        const cropX = transform.sourceRect.x
        const pdfCropY = height - transform.sourceRect.y - transform.sourceRect.height
        const cropWidth = transform.sourceRect.width
        const cropHeight = transform.sourceRect.height
        
        // Step 1: Translate to CENTER the crop on the page AND apply user offset
        // This positions (0,0) in user space at the location where the crop should start
        const centerOffsetX = (width - cropWidth) / 2 + transform.offsetX
        const centerOffsetY = (height - cropHeight) / 2 + transform.offsetY
        newPage.pushOperators(
          concatTransformationMatrix(1, 0, 0, 1, centerOffsetX, centerOffsetY)
        )
        console.log(`  📐 Centering crop + user offset: [${centerOffsetX.toFixed(1)}, ${centerOffsetY.toFixed(1)}] (user offset: ${transform.offsetX}, ${transform.offsetY})`)
        
        // Step 2: Apply rotation and scale (around crop region center)
        if (hasRotation || hasScale) {
          const rotation = history.rotation || 0
          const radians = (-rotation * Math.PI) / 180  // Negate for CCW
          const cos = Math.cos(radians)
          const sin = Math.sin(radians)
          const scale = transform.finalScale
          
          // Center of rotation is crop center (in current coordinates)
          const centerX = cropWidth / 2
          const centerY = cropHeight / 2
          
          // Translate to center
          newPage.pushOperators(
            concatTransformationMatrix(1, 0, 0, 1, centerX, centerY)
          )
          
          // Rotate and scale
          newPage.pushOperators(
            concatTransformationMatrix(
              scale * cos,  // a
              scale * sin,  // b
              -scale * sin, // c
              scale * cos,  // d
              0,            // e
              0             // f
            )
          )
          
          // Translate back from center
          newPage.pushOperators(
            concatTransformationMatrix(1, 0, 0, 1, -centerX, -centerY)
          )
          
          console.log(`  ↻ Applied rotation ${rotation}° and scale ${scale.toFixed(3)}x around crop center`)
        }
        
        // Step 3: Apply clipping (at origin with crop dimensions)
        if (hasCrop) {
          // Clip rectangle at (0,0) with crop dimensions
          newPage.pushOperators(
            moveTo(0, 0),
            lineTo(cropWidth, 0),
            lineTo(cropWidth, cropHeight),
            lineTo(0, cropHeight),
            closePath(),
            clip(),
            endPath()
          )
          console.log(`  ✂️ Crop clip: [0, 0, ${cropWidth.toFixed(1)}×${cropHeight.toFixed(1)}]`)
        }
        
        // Step 4: Draw the embedded page
        // Position it so the crop region appears at (0,0) in current space
        const drawX = -cropX
        const drawY = -pdfCropY
        
        newPage.drawPage(embeddedPage, {
          x: drawX,
          y: drawY,
          width: width,
          height: height
        })
        
        newPage.pushOperators(popGraphicsState())
        
        console.log(`  ✅ Page transformed (vectors preserved)`)
        
        processedCount++
        // Track memory every 10 pages
        if (processedCount % 10 === 0) {
          memoryTracker.current?.mark(`🔄 Processed ${processedCount}/${transformedPages.size} pages`)
        }
      }
      
      console.log(`✅ Export complete: ${transformedPages.size} pages with vector-preserving transforms`)
      memoryTracker.current?.mark(`✅ Transformation loop complete (${transformedPages.size} pages)`)
      
      memoryTracker.current?.mark('💾 Before pdfDoc.save() - RAM CRITICAL POINT')
      const pdfBytes = await pdfDoc.save()
      memoryTracker.current?.mark(`💾 After pdfDoc.save() (${(pdfBytes.byteLength / 1024 / 1024).toFixed(2)} MB output)`)
      
      const editedFile = new File([pdfBytes], file.name, { type: 'application/pdf' })
      
      memoryTracker.current?.mark('🏁 Export complete')
      memoryTracker.current?.printDetailedReport()
      
      // Notify PDFPageSelector about the final export
      const editedPagesNotification = {}
      originalPages.forEach(page => {
        if (page.edited) {
          editedPagesNotification[page.pageNumber] = {
            thumbnail: page.thumbnail,
            edited: true,
            canvas: page.canvas
          }
        }
      })
      
      const updateEvent = new CustomEvent('pdfEditorUpdate', {
        detail: { 
          editedPages: editedPagesNotification,
          finalPDF: editedFile
        }
      })
      window.dispatchEvent(updateEvent)
      
      onSave(editedFile)
      
    } catch (error) {
      console.error('❌ Error exporting PDF:', error)
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
      console.error('Error name:', error.name)
      alert(`Error exporting PDF: ${error.message || error}`)
    } finally {
      setLoading(false)
    }
  }


  if (error) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 bg-red-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
          <X className="w-8 h-8 text-red-600" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Error Loading PDF</h3>
        <p className="text-gray-600 mb-6">{error}</p>
        <button
          onClick={onCancel}
          className="px-6 py-3 bg-gray-600 text-white rounded-xl hover:bg-gray-700 transition-all duration-200"
        >
          Close Editor
        </button>
      </div>
    )
  }

  // Document Viewer (Main View) - Only show if not directPageEdit and not showEditPopup
  if (!showEditPopup && !directPageEdit) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-3 sm:p-6">
        {/* Header */}
        <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg sm:text-2xl font-bold text-gray-900">PDF Editor</h2>
            <p className="text-xs sm:text-sm text-gray-600">
              {pages.length > 0 ? `${pdf?.numPages || allPages.length} pages` : 'Loading...'}
            </p>
          </div>
        </div>

        {/* Loading Banner - Single top-level progress indicator */}
        <LoadingExperience 
          loadingStage={loadingStage}
          loadedCount={allPages.filter(p => p.isLoaded).length}
          totalPages={allPages.length}
        />

        {/* Pages Grid - Always render from allPages for scroll detection */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3">
          {allPages.map((page, index) => {
            const isSelected = onPageSelect && selectedPages.includes(page.pageNumber)
            
            return (
            <div
              key={page.pageNumber}
              ref={el => pageRefs.current[page.pageNumber] = el}
              data-page-number={page.pageNumber}
              className={`relative bg-white border-2 rounded-lg p-2 hover:shadow-lg transition-all overflow-hidden ${
                isSelected 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-200 hover:border-blue-400'
              }`}
            >
              {/* Selection Checkbox - Only show if onPageSelect is provided */}
              {onPageSelect && !page.isSheet && (
                <div className="absolute top-1 left-1 z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onPageSelect(page.pageNumber)
                    }}
                    className="bg-white rounded shadow-sm p-1 hover:bg-gray-50"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </div>
              )}
              
              {/* Page Preview */}
              <div 
                className="relative mb-1.5 cursor-pointer"
                onClick={() => {
                  if (onPageSelect && !page.isSheet) {
                    onPageSelect(page.pageNumber)
                  }
                }}
              >
                <div className="aspect-[3/4] bg-gray-50 rounded overflow-hidden border border-gray-200">
                  {(page.isLoaded || page.thumbnail) && page.thumbnail ? (
                    <img
                      src={page.thumbnail}
                      alt={`Page ${page.pageNumber}`}
                      className="w-full h-full object-contain p-1 animate-fade-in"
                    />
                  ) : (
                    <ShimmerLoader width="100%" height="100%" />
                  )}
                </div>

                {/* Edit Status Badge */}
                {page.edited && (
                  <div className="absolute top-1 right-1 bg-green-500 text-white px-2 py-0.5 rounded text-[10px] font-semibold">
                    Edited
                  </div>
                )}
              </div>

              {/* Page Info */}
              <div className="text-center mb-1.5">
                <h3 className="font-semibold text-gray-800 text-xs">{page.isSheet ? `Pages ${page.pageNumber}` : `Page ${page.pageNumber}`}</h3>
              </div>

              {/* Edit Button */}
              <button
                onClick={() => {
                  // Load page if not loaded before editing
                  if (!page.isLoaded && !page.isSheet) {
                    loadSinglePage(page.pageNumber).then(() => {
                      // Find the index in the pages array after loading
                      const pageIndex = pages.findIndex(p => p.pageNumber === page.pageNumber)
                      if (pageIndex !== -1) {
                        openEditPopup(pageIndex)
                      }
                    })
                  } else {
                    const pageIndex = pages.findIndex(p => p.pageNumber === page.pageNumber)
                    if (pageIndex !== -1) {
                      openEditPopup(pageIndex)
                    }
                  }
                }}
                disabled={page.isLoading}
                className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Edit3 className="w-3 h-3" />
                {page.isLoading ? 'Loading...' : 'Edit'}
              </button>
            </div>
            );
          })}
        </div>
      </div>
    )
  }

  // Edit Popup (Full Screen) - Show when showEditPopup is true OR directPageEdit is true
  const currentPage = pages[editingPageIndex]

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white px-2 py-2 sm:px-4 sm:py-3 flex items-center justify-between flex-shrink-0 shadow-md">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <Edit3 className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h2 className="text-sm sm:text-base font-bold truncate">Page {currentPage?.pageNumber}</h2>
              <div className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                colorMode === 'Color'
                  ? 'bg-pink-500 text-white'
                  : 'bg-white/25 text-white'
              }`}>
                {colorMode === 'Color' ? '🎨' : '⚫'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="hidden sm:flex items-center gap-1 bg-white/15 rounded-md px-2 py-1">
              <button
                onClick={() => setZoom(zoomPanHandler.zoomOut(zoom))}
                className="p-1 hover:bg-white/20 rounded transition-colors"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <span className="text-xs font-bold px-1">
                {zoomPanHandler.formatZoomPercent(zoom)}
              </span>
              <button
                onClick={() => setZoom(zoomPanHandler.zoomIn(zoom))}
                className="p-1 hover:bg-white/20 rounded transition-colors"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
            </div>
            
            <button
              onClick={closeEditPopup}
              className="p-1.5 bg-white/15 hover:bg-white/25 rounded transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Image Display Area - Maximum Space */}
        <div className="flex-1 bg-gray-100 flex items-center justify-center relative overflow-auto">
          <div
            ref={imageContainerRef}
            className="image-container relative w-full h-full flex items-center justify-center"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchMove={(e) => {
              if (isDragging) {
                e.preventDefault()
                const touch = e.touches[0]
                handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {} })
              }
            }}
            onTouchEnd={handleMouseUp}
          >
            {currentPage && (
              <>
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-full object-contain"
                />
                
                {/* Grid Overlay */}
                {showGrid && (
                  <div 
                    className="absolute inset-0 pointer-events-none opacity-30"
                    style={{
                      backgroundImage: `
                        linear-gradient(rgba(59, 130, 246, 0.3) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(59, 130, 246, 0.3) 1px, transparent 1px)
                      `,
                      backgroundSize: '20px 20px'
                    }}
                  />
                )}
                
                {cropMode && cropArea && canvasRef.current && (() => {
                  const canvas = canvasRef.current

                  // Get the canvas element's actual rendered position in the DOM
                  const canvasRect = canvas.getBoundingClientRect()
                  const container = canvas.closest('.image-container')
                  const containerRect = container.getBoundingClientRect()

                  // The canvas CSS size in the DOM - MUST divide by zoom!
                  // canvasRect.width is already zoomed, we need the base unzoomed size
                  const canvasDOMWidth = canvasRect.width / zoom
                  const canvasDOMHeight = canvasRect.height / zoom

                  // The canvas internal size (in canvas pixels)
                  const canvasPixelWidth = canvas.width
                  const canvasPixelHeight = canvas.height

                  // Ratio to convert canvas pixels to DOM pixels (zoom-independent)
                  const pixelToDOMRatioX = canvasDOMWidth / canvasPixelWidth
                  const pixelToDOMRatioY = canvasDOMHeight / canvasPixelHeight

                  // Convert crop area (in canvas pixels) to DOM pixels
                  const domX = cropArea.x * pixelToDOMRatioX
                  const domY = cropArea.y * pixelToDOMRatioY
                  const domWidth = cropArea.width * pixelToDOMRatioX
                  const domHeight = cropArea.height * pixelToDOMRatioY

                  // Calculate canvas position relative to container (accounting for centering)
                  const canvasLeft = (containerRect.width / zoom - canvasDOMWidth) / 2
                  const canvasTop = (containerRect.height / zoom - canvasDOMHeight) / 2

                  console.log('🎨 Crop overlay (CANVAS PIXEL SPACE):', {
                    canvasPixels: `(${cropArea.x.toFixed(1)}, ${cropArea.y.toFixed(1)})`,
                    canvasSize: `${cropArea.width.toFixed(1)}×${cropArea.height.toFixed(1)}`,
                    domPos: `(${domX.toFixed(1)}, ${domY.toFixed(1)})`,
                    domSize: `${domWidth.toFixed(1)}×${domHeight.toFixed(1)}`,
                    canvasPosition: `(${canvasLeft.toFixed(1)}, ${canvasTop.toFixed(1)})`
                  })

                  return (
                    <div className="absolute inset-0 pointer-events-none">
                      <div
                        className="absolute border-2 border-blue-500 bg-blue-500/10 backdrop-blur-sm pointer-events-auto"
                        style={{
                          left: canvasLeft + domX,
                          top: canvasTop + domY,
                          width: domWidth,
                          height: domHeight,
                          transition: 'none'
                        }}
                      >
                        <div className="absolute inset-0 border-2 border-dashed border-white/80 rounded-sm" />

                        <div className="absolute inset-0 opacity-40">
                          <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white" />
                          <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white" />
                          <div className="absolute top-1/3 left-0 right-0 h-px bg-white" />
                          <div className="absolute top-2/3 left-0 right-0 h-px bg-white" />
                        </div>

                        {[
                          { handle: 'nw', position: { left: -10, top: -10 }, cursor: 'nw-resize' },
                          { handle: 'ne', position: { right: -10, top: -10 }, cursor: 'ne-resize' },
                          { handle: 'sw', position: { left: -10, bottom: -10 }, cursor: 'sw-resize' },
                          { handle: 'se', position: { right: -10, bottom: -10 }, cursor: 'se-resize' }
                        ].map(({ handle, position, cursor }) => (
                          <div
                            key={handle}
                            className={`absolute w-8 h-8 sm:w-7 sm:h-7 bg-gradient-to-br from-blue-400 to-blue-600 border-3 border-white rounded-full shadow-lg cursor-${cursor} hover:scale-110 active:scale-125 transition-all duration-150 hover:shadow-xl z-10 pointer-events-auto touch-none`}
                            style={position}
                            onMouseDown={(e) => handleMouseDown(e, handle)}
                            onTouchStart={(e) => {
                              e.preventDefault()
                              const touch = e.touches[0]
                              handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {}, stopPropagation: () => {} }, handle)
                            }}
                          />
                        ))}

                        <div
                          className="absolute w-10 h-10 sm:w-9 sm:h-9 bg-gradient-to-br from-blue-500 to-purple-600 border-3 border-white rounded-full shadow-lg cursor-move hover:scale-110 active:scale-125 transition-all duration-150 hover:shadow-xl flex items-center justify-center z-10 pointer-events-auto touch-none"
                          style={{
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                          }}
                          onMouseDown={(e) => handleMouseDown(e, 'center')}
                          onTouchStart={(e) => {
                            e.preventDefault()
                            const touch = e.touches[0]
                            handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {}, stopPropagation: () => {} }, 'center')
                          }}
                        >
                          <Move className="w-4 h-4 text-white" />
                        </div>

                        <div className="absolute -top-8 left-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-2 py-1 rounded text-xs font-medium shadow-lg pointer-events-none">
                          📐 {Math.round(cropArea.width)} × {Math.round(cropArea.height)}
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </>
            )}
          </div>
        </div>

        {/* Compact Bottom Controls */}
        <div className="bg-gray-50 border-t border-gray-200 p-2 flex-shrink-0">
          {/* Tab Navigation - Cleaner Design */}
          <div className="flex gap-1 mb-2 bg-white rounded-lg p-1 border border-gray-200">
            {[
              { id: 'pagesize', label: 'Page', icon: Maximize2 },
              { id: 'crop', label: 'Crop', icon: Crop },
              { id: 'rotation', label: 'Rotation', icon: RotateCw }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all text-xs flex-1 ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Compact Controls in One Horizontal Line */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Page Size Controls */}
            {activeTab === 'pagesize' && (
              <div className="tab-content-enter flex items-center gap-1 flex-wrap">
                <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 flex-wrap">
                  <div className="flex items-center gap-1">
                    <Maximize2 className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-medium whitespace-nowrap">Page Size:</span>
                  </div>
                  <Dropdown
                    value={tempPageSize}
                    onChange={setTempPageSize}
                    options={Object.entries(PAGE_SIZES).map(([key, size]) => ({
                      value: key,
                      label: size.displayName
                    }))}
                    fullWidth={false}
                    className="min-w-[140px]"
                  />
                </div>
                <button
                  onClick={() => {
                    setCurrentPageSize(tempPageSize)
                    if (onPageSizeChange) {
                      onPageSizeChange(tempPageSize)
                    }
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs font-semibold"
                >
                  <Check className="w-3.5 h-3.5" />
                  Apply
                </button>
              </div>
            )}

            {/* Crop Controls */}
            {activeTab === 'crop' && (
              <div className="tab-content-enter flex items-center gap-2 flex-wrap w-full">
                {/* Warning for N-up sheets - crop disabled */}
                {pagesPerSheet === 2 && pages[editingPageIndex]?.isSheet ? (
                  <div className="w-full bg-yellow-50 border border-yellow-300 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-yellow-800">
                        <p className="font-semibold mb-1">⚠️ Crop Cannot Be Applied to N-up Sheets</p>
                        <p className="mt-1 font-medium">Recommended: Switch to individual pages (remove N-up), apply crop to each page separately, then re-enable N-up mode.</p>
                      </div>
                    </div>
                  </div>
                ) : settings.rotation && settings.rotation !== 0 ? (
                  // ROTATION DETECTED - Professional warning with clear guidance
                  <div className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                    {/* Main message with icon */}
                    <div className="flex items-start gap-2 mb-2">
                      <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs text-gray-800 leading-relaxed">
                          Cropping cannot be performed after rotation. To ensure correct results, please crop your page before applying rotation.
                        </p>
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-gray-200 my-2"></div>

                    {/* Recommended workflow */}
                    <div className="mb-2">
                      <p className="text-xs font-semibold text-gray-700 mb-1.5">Recommended Order:</p>
                      <ol className="space-y-1 ml-1">
                        <li className="flex items-start gap-2 text-xs text-gray-600">
                          <span className="font-semibold text-gray-700">1.</span>
                          <span>Crop your page to the desired area</span>
                        </li>
                        <li className="flex items-start gap-2 text-xs text-gray-600">
                          <span className="font-semibold text-gray-700">2.</span>
                          <span>Then rotate if needed</span>
                        </li>
                      </ol>
                    </div>

                    {/* Reset action */}
                    <div className="flex items-center justify-between pt-1.5">
                      <p className="text-xs text-gray-500">Need to start over?</p>
                      <button
                        onClick={clearPageEdits}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 hover:border-blue-500 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg transition-colors text-xs font-medium"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Clear All Edits
                      </button>
                    </div>
                  </div>
                ) : (
                  // NO ROTATION - Normal crop controls
                  <>
                    {!cropMode ? (
                      <button
                        onClick={startCrop}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs font-semibold"
                      >
                        <Scissors className="w-3.5 h-3.5" />
                        Start Cropping
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={applyCrop}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs font-semibold"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Apply Crop
                        </button>
                        <button
                          onClick={() => {
                            setCropMode(false)
                            setCropArea(null)
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors text-xs font-semibold"
                        >
                          <X className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      </div>
                    )}

                    <button
                      onClick={() => setShowGrid(!showGrid)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors text-xs font-semibold ${
                        showGrid 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-white text-gray-700 border border-gray-300'
                      }`}
                    >
                      <Grid className="w-3.5 h-3.5" />
                      Grid
                    </button>
                    
                    {/* Size Toggle Button */}
                    <button
                      onClick={() => setShowCropSizeSlider(!showCropSizeSlider)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs font-semibold ${
                        showCropSizeSlider
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-700 border border-gray-300'
                      }`}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      Size
                    </button>

                    {/* Size Slider - Collapsible */}
                    {showCropSizeSlider && (
                      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5 w-full">
                        <Maximize2 className="w-3 h-3 text-gray-500 flex-shrink-0" />
                        <input
                          type="range"
                          min="10"
                          max="700"
                          step="5"
                          value={userScale}
                          onChange={(e) => {
                            const newScale = parseInt(e.target.value)
                            setUserScale(newScale)
                            setSettings(prev => ({ ...prev, scale: newScale }))
                          }}
                          className="flex-1 h-1"
                        />
                        <span className="text-xs text-gray-700 font-medium min-w-[38px] text-right">{userScale}%</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Rotation Controls - Compact Horizontal Layout with Collapsible Sliders */}
            {activeTab === 'rotation' && (
              <div className="tab-content-enter flex flex-col gap-2 w-full">
                {/* Rotation Row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => handleRotationChange(-90)}
                    className="px-4 py-1.5 bg-white border border-gray-300 hover:border-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Rotate Left"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-gray-700" />
                  </button>
                  <button
                    onClick={() => handleRotationChange(90)}
                    className="px-4 py-1.5 bg-white border border-gray-300 hover:border-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Rotate Right"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-gray-700" />
                  </button>
                  <div className="px-2.5 py-1 bg-blue-600 text-white rounded-md text-xs font-medium min-w-[48px] text-center">
                    {settings.rotation}°
                  </div>
                  <button
                    onClick={resetSettings}
                    className="flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-300 hover:border-red-500 hover:bg-red-50 text-gray-700 hover:text-red-700 rounded-lg transition-colors text-xs font-medium"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reset
                  </button>
                </div>

                {/* Toggle Buttons for Sliders */}
                <div className="flex gap-1.5 flex-wrap items-center">
                  <button
                    onClick={() => {
                      setShowScaleSlider(true)
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium ${
                      showScaleSlider
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Scale
                  </button>
                  <button
                    onClick={applyToAllPages}
                    disabled={isApplyingAll}
                    className={`relative flex items-center gap-1 px-3 py-1.5 text-white rounded-lg text-xs font-medium overflow-hidden ${
                      isApplyingAll 
                        ? 'bg-purple-600 cursor-wait' 
                        : 'bg-purple-600 hover:bg-purple-700 transition-colors'
                    }`}
                  >
                    {isApplyingAll && (
                      <div className="absolute inset-0 overflow-hidden">
                        <div 
                          className="absolute top-0 left-0 bottom-0 bg-white/40 transition-all duration-75 ease-linear"
                          style={{ width: `${applyAllProgress * 100}%` }}
                        />
                      </div>
                    )}
                    <div className="relative flex items-center gap-1 z-10">
                      <FileText className="w-3 h-3" />
                      {isApplyingAll ? 'Applying...' : 'Apply to All'}
                    </div>
                  </button>
                </div>

                {/* Collapsible Sliders */}
                <div className="flex flex-col gap-1.5">
                  {/* Scale Slider */}
                  {showScaleSlider && (
                    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5">
                      <Maximize2 className="w-3 h-3 text-gray-500 flex-shrink-0" />
                      <input
                        type="range"
                        min="10"
                        max="700"
                        step="5"
                        value={userScale}
                        onChange={(e) => {
                          const newScale = parseInt(e.target.value)
                          setUserScale(newScale)
                          setSettings(prev => ({ ...prev, scale: newScale }))
                        }}
                        className="flex-1 h-1"
                      />
                      <span className="text-xs text-gray-700 font-medium min-w-[38px] text-right">{userScale}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="mt-3 pt-3 border-t border-gray-200">
            <button
              onClick={applyAllChanges}
              disabled={isApplying}
              className={`relative w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all text-xs font-medium overflow-hidden ${
                isApplying 
                  ? 'bg-violet-600 cursor-wait' 
                  : 'bg-violet-600 hover:bg-violet-700 hover:shadow-lg'
              } text-white`}
            >
              {/* Progress-based animation */}
              {isApplying && (
                <div className="absolute inset-0 overflow-hidden">
                  <div 
                    className="absolute top-0 left-0 bottom-0 bg-white/40 transition-all duration-75 ease-linear"
                    style={{ width: `${applyProgress * 100}%` }}
                  />
                </div>
              )}
              
              <div className="relative flex items-center gap-2 z-10">
                {isApplying ? (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Applying Changes...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    {directPageEdit ? 'Save & Close' : 'Apply Changes'}
                  </>
                )}
              </div>
            </button>
          </div>
        </div>

      {/* Apply All Confirmation Dialog */}
      {showApplyWarning && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-scale-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
              <div className="flex items-center gap-3 text-white">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Apply to All Pages</h3>
                  <p className="text-blue-100 text-sm">Confirm your action</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-5">
              <p className="text-gray-700 text-sm leading-relaxed mb-1">
                Apply current <span className="font-semibold text-gray-900">
                  {activeTab === 'color' ? 'color adjustments' : activeTab === 'rotation' ? 'rotation settings' : 'settings'}
                </span> to all pages in the document?
              </p>
              <p className="text-gray-500 text-xs mt-2">
                ⚡ <strong>Instant operation</strong> - applies to loaded pages immediately. Unloaded pages will get these settings when viewed.
              </p>
            </div>

            {/* Actions */}
            <div className="px-6 py-4 bg-gray-50 flex gap-3 justify-end">
              <button
                onClick={() => setShowApplyWarning(false)}
                disabled={isApplyingAll}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all duration-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={confirmApplyToAll}
                disabled={isApplyingAll}
                className={`relative px-5 py-2.5 text-sm font-medium text-white rounded-lg transition-all duration-200 shadow-md overflow-hidden ${
                  isApplyingAll 
                    ? 'bg-blue-600 cursor-wait' 
                    : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 hover:shadow-lg'
                }`}
              >
                {/* Progressive fill animation */}
                {isApplyingAll && (
                  <div className="absolute inset-0 overflow-hidden">
                    <div 
                      className="absolute top-0 left-0 bottom-0 bg-white/30"
                      style={{ width: `${applyAllProgress * 100}%` }}
                    />
                  </div>
                )}
                
                <span className="relative z-10">
                  {isApplyingAll ? 'Applying to All...' : 'Apply to All'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <UnsavedChangesPopup
        isOpen={showUnsavedChangesPopup}
        onDiscard={handleDiscardChanges}
        onSaveAndClose={handleSaveAndClose}
        message="You have unsaved edits to this PDF. Would you like to save your changes before closing?"
      />
    </div>
  )
})

PDFEditor.displayName = 'PDFEditor'

export default PDFEditor
