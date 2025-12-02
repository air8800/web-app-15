/**
 * usePdfController
 * 
 * React hook that provides the PdfController interface.
 * Uses a feature flag to switch between legacy and modern implementations.
 * 
 * Feature flag: USE_NEW_PDF_CONTROLLER
 * - false (default): Uses LegacyAdapter wrapping PDFEditor.jsx
 * - true: Uses ModernAdapter with new pdf2 services
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import {
  PdfController,
  EditCommand,
  Recipe
} from '../types'
import { LegacyAdapter, LegacyPdfEditorRef } from './legacyAdapter'
import { ModernAdapter, ModernAdapterOptions } from './modernAdapter'

/**
 * Feature flag - set to true to use new implementation
 */
export const USE_NEW_PDF_CONTROLLER = true

export interface UsePdfControllerOptions extends ModernAdapterOptions {
  useNewImplementation?: boolean
}

export interface UsePdfControllerResult {
  controller: PdfController | null
  isReady: boolean
  isLoading: boolean
  error: string | null
  
  // For legacy mode: function to set the PDFEditor ref
  setLegacyRef: (ref: LegacyPdfEditorRef | null) => void
  
  // Convenience methods
  loadDocument: (file: File) => Promise<void>
  applyEdit: (pageNum: number, edit: EditCommand) => void
  exportRecipe: () => Recipe | null
  resetPage: (pageNum: number) => void
  resetAll: () => void
}

export function usePdfController(
  options: UsePdfControllerOptions = {}
): UsePdfControllerResult {
  const useNew = options.useNewImplementation ?? USE_NEW_PDF_CONTROLLER
  
  // Initialize adapter synchronously using useMemo to ensure it's available immediately
  const modernAdapterRef = useRef<ModernAdapter | null>(null)
  const legacyAdapterRef = useRef<LegacyAdapter | null>(null)
  
  // Create adapter immediately (not in useEffect) so it's available on first render
  useMemo(() => {
    if (useNew && !modernAdapterRef.current) {
      modernAdapterRef.current = new ModernAdapter(options)
      console.log('[usePdfController] ModernAdapter created synchronously')
    } else if (!useNew && !legacyAdapterRef.current) {
      legacyAdapterRef.current = new LegacyAdapter()
    }
  }, [useNew])
  
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      modernAdapterRef.current?.destroy()
      legacyAdapterRef.current?.destroy()
    }
  }, [])

  // Get current controller
  const getController = useCallback((): PdfController | null => {
    return useNew ? modernAdapterRef.current : legacyAdapterRef.current
  }, [useNew])

  // Set legacy ref (for connecting to PDFEditor component)
  const setLegacyRef = useCallback((ref: LegacyPdfEditorRef | null) => {
    if (legacyAdapterRef.current) {
      if (ref) {
        legacyAdapterRef.current.setRef(ref)
        setIsReady(true)
      } else {
        setIsReady(false)
      }
    }
  }, [])

  // Load document
  const loadDocument = useCallback(async (file: File): Promise<void> => {
    const controller = getController()
    if (!controller) {
      throw new Error('Controller not initialized')
    }

    setIsLoading(true)
    setError(null)

    try {
      await controller.loadDocument(file)
      setIsReady(true)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load document'
      setError(message)
      throw e
    } finally {
      setIsLoading(false)
    }
  }, [getController])

  // Apply edit
  const applyEdit = useCallback((pageNum: number, edit: EditCommand): void => {
    const controller = getController()
    if (controller) {
      controller.applyEdit(pageNum, edit)
    }
  }, [getController])

  // Export recipe
  const exportRecipe = useCallback((): Recipe | null => {
    const controller = getController()
    if (!controller) return null
    
    try {
      return controller.exportRecipe()
    } catch (e) {
      console.error('[usePdfController] exportRecipe failed:', e)
      return null
    }
  }, [getController])

  // Reset page
  const resetPage = useCallback((pageNum: number): void => {
    const controller = getController()
    if (controller) {
      controller.resetPage(pageNum)
    }
  }, [getController])

  // Reset all
  const resetAll = useCallback((): void => {
    const controller = getController()
    if (controller) {
      controller.resetAll()
    }
  }, [getController])

  return {
    controller: getController(),
    isReady,
    isLoading,
    error,
    setLegacyRef,
    loadDocument,
    applyEdit,
    exportRecipe,
    resetPage,
    resetAll
  }
}

/**
 * Type guard to check if using modern adapter
 */
export function isModernController(
  controller: PdfController
): controller is ModernAdapter {
  return controller instanceof ModernAdapter
}

/**
 * Type guard to check if using legacy adapter
 */
export function isLegacyController(
  controller: PdfController
): controller is LegacyAdapter {
  return controller instanceof LegacyAdapter
}
