/**
 * CanvasInteraction
 * 
 * Handles all mouse/touch interactions on the canvas.
 * Supports crop box dragging, resizing, and page pan.
 * 
 * ATTACHMENT POINT: PDFEditor.jsx attaches to canvas element
 */

import { CropBox, DragHandle, DragState, ImageRect } from '../types'
import { CropHandler } from './cropHandler'

/**
 * CropDragController
 * 
 * Handles zoom-aware crop dragging logic extracted from PDFEditor.jsx handleMouseMove.
 * Uses CropHandler for pure math operations.
 */
export interface CropDragDeps {
  cropHandler: CropHandler
  getZoom: () => number
  getCanvas: () => HTMLCanvasElement | null
  getContainer: () => HTMLElement | null
}

export interface CropDragStart {
  domX: number
  domY: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
}

export type CropDragHandle = 'nw' | 'ne' | 'sw' | 'se' | 'center' | null

export class CropDragController {
  private deps: CropDragDeps
  private dragStart: CropDragStart | null = null
  private currentHandle: CropDragHandle = null
  private rafId: number | null = null

  constructor(deps: CropDragDeps) {
    this.deps = deps
  }

  /**
   * Start a crop drag operation
   * EXACT COPY of handleMouseDown logic from PDFEditor.jsx
   */
  startDrag(
    clientX: number,
    clientY: number,
    handle: CropDragHandle,
    currentCrop: { x: number; y: number; width: number; height: number }
  ): void {
    const zoom = this.deps.getZoom()
    const container = this.deps.getContainer()
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    
    // Apply zoom division to get zoom-independent coordinates
    const domX = (clientX - containerRect.left) / zoom
    const domY = (clientY - containerRect.top) / zoom

    this.currentHandle = handle
    this.dragStart = {
      domX,
      domY,
      cropX: currentCrop.x,
      cropY: currentCrop.y,
      cropWidth: currentCrop.width,
      cropHeight: currentCrop.height
    }

    console.log('🖱️ Crop drag started:', handle, 'at zoom:', (zoom * 100).toFixed(0) + '%')
  }

  /**
   * Continue a crop drag operation
   * EXACT COPY of handleMouseMove logic from PDFEditor.jsx
   * 
   * @returns Updated crop area or null if not dragging
   */
  continueDrag(
    clientX: number,
    clientY: number
  ): { x: number; y: number; width: number; height: number } | null {
    if (!this.dragStart || !this.currentHandle) return null

    const zoom = this.deps.getZoom()
    const canvas = this.deps.getCanvas()
    const container = this.deps.getContainer()
    if (!canvas || !container) return null

    const containerRect = container.getBoundingClientRect()
    const rect = canvas.getBoundingClientRect()

    // Get current position in zoom-independent DOM coordinates
    const currentDomX = (clientX - containerRect.left) / zoom
    const currentDomY = (clientY - containerRect.top) / zoom

    // Calculate delta in DOM pixels (zoom-independent)
    const domDeltaX = currentDomX - this.dragStart.domX
    const domDeltaY = currentDomY - this.dragStart.domY

    // Get canvas DOM dimensions WITHOUT zoom scaling
    const canvasDOMWidth = rect.width / zoom
    const canvasDOMHeight = rect.height / zoom

    // Convert DOM delta to canvas pixel delta
    const pixelToDOMRatioX = canvasDOMWidth / canvas.width
    const pixelToDOMRatioY = canvasDOMHeight / canvas.height

    const deltaX = domDeltaX / pixelToDOMRatioX
    const deltaY = domDeltaY / pixelToDOMRatioY

    console.log('🎯 Crop drag at zoom ' + (zoom * 100).toFixed(0) + '%:', {
      domDelta: `(${domDeltaX.toFixed(1)}, ${domDeltaY.toFixed(1)})`,
      canvasDOMSize: `${canvasDOMWidth.toFixed(1)}×${canvasDOMHeight.toFixed(1)}`,
      canvasPixelSize: `${canvas.width}×${canvas.height}`,
      ratio: `${pixelToDOMRatioX.toFixed(3)}`,
      pixelDelta: `(${deltaX.toFixed(1)}, ${deltaY.toFixed(1)})`
    })

    let newCropArea = {
      x: this.dragStart.cropX,
      y: this.dragStart.cropY,
      width: this.dragStart.cropWidth,
      height: this.dragStart.cropHeight
    }

    const minSize = 50
    const margin = 10

    // Handle-specific logic - EXACT COPY from PDFEditor.jsx
    switch (this.currentHandle) {
      case 'nw': {
        const newX = this.deps.cropHandler.clampValue(
          this.dragStart.cropX + deltaX,
          margin,
          this.dragStart.cropX + this.dragStart.cropWidth - minSize
        )
        const newY = this.deps.cropHandler.clampValue(
          this.dragStart.cropY + deltaY,
          margin,
          this.dragStart.cropY + this.dragStart.cropHeight - minSize
        )
        newCropArea.x = newX
        newCropArea.y = newY
        newCropArea.width = this.dragStart.cropWidth - (newX - this.dragStart.cropX)
        newCropArea.height = this.dragStart.cropHeight - (newY - this.dragStart.cropY)
        break
      }
      case 'ne': {
        const newYNE = this.deps.cropHandler.clampValue(
          this.dragStart.cropY + deltaY,
          margin,
          this.dragStart.cropY + this.dragStart.cropHeight - minSize
        )
        newCropArea.y = newYNE
        newCropArea.width = this.deps.cropHandler.clampValue(
          this.dragStart.cropWidth + deltaX,
          minSize,
          canvas.width - this.dragStart.cropX - margin
        )
        newCropArea.height = this.dragStart.cropHeight - (newYNE - this.dragStart.cropY)
        break
      }
      case 'sw': {
        const newXSW = this.deps.cropHandler.clampValue(
          this.dragStart.cropX + deltaX,
          margin,
          this.dragStart.cropX + this.dragStart.cropWidth - minSize
        )
        newCropArea.x = newXSW
        newCropArea.width = this.dragStart.cropWidth - (newXSW - this.dragStart.cropX)
        newCropArea.height = this.deps.cropHandler.clampValue(
          this.dragStart.cropHeight + deltaY,
          minSize,
          canvas.height - this.dragStart.cropY - margin
        )
        break
      }
      case 'se': {
        newCropArea.width = this.deps.cropHandler.clampValue(
          this.dragStart.cropWidth + deltaX,
          minSize,
          canvas.width - this.dragStart.cropX - margin
        )
        newCropArea.height = this.deps.cropHandler.clampValue(
          this.dragStart.cropHeight + deltaY,
          minSize,
          canvas.height - this.dragStart.cropY - margin
        )
        break
      }
      case 'center': {
        newCropArea.x = this.deps.cropHandler.clampValue(
          this.dragStart.cropX + deltaX,
          margin,
          canvas.width - this.dragStart.cropWidth - margin
        )
        newCropArea.y = this.deps.cropHandler.clampValue(
          this.dragStart.cropY + deltaY,
          margin,
          canvas.height - this.dragStart.cropHeight - margin
        )
        break
      }
    }

    // Apply final boundary constraints using cropHandler
    return this.deps.cropHandler.enforceBoundaries(
      newCropArea,
      canvas.width,
      canvas.height,
      margin,
      minSize
    )
  }

  /**
   * End a crop drag operation
   */
  endDrag(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.dragStart = null
    this.currentHandle = null
  }

  /**
   * Check if currently dragging
   */
  isDragging(): boolean {
    return this.dragStart !== null
  }

  /**
   * Get current handle being dragged
   */
  getCurrentHandle(): CropDragHandle {
    return this.currentHandle
  }

  /**
   * Schedule a drag continuation with requestAnimationFrame
   * Returns a function to execute with the event
   */
  scheduleDrag(
    callback: (result: { x: number; y: number; width: number; height: number } | null) => void
  ): (clientX: number, clientY: number) => void {
    return (clientX: number, clientY: number) => {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId)
      }

      this.rafId = requestAnimationFrame(() => {
        const result = this.continueDrag(clientX, clientY)
        callback(result)
        this.rafId = null
      })
    }
  }
}

export type InteractionMode = 'crop' | 'pan' | 'none'

export interface InteractionCallbacks {
  onCropChange: (crop: CropBox) => void
  onCropComplete: (crop: CropBox) => void
  onPan: (dx: number, dy: number) => void
  onPanComplete: () => void
}

export interface CropDrawParams {
  imgX: number
  imgY: number
  imgW: number
  imgH: number
  cropScreenX: number
  cropScreenY: number
  cropScreenW: number
  cropScreenH: number
}

export class CanvasInteraction {
  private canvas: HTMLCanvasElement | null = null
  private mode: InteractionMode = 'none'
  private callbacks: InteractionCallbacks | null = null
  
  private dragState: DragState = {
    isDragging: false,
    handle: null,
    startX: 0,
    startY: 0,
    startCrop: null
  }

  private imageRect: ImageRect = { left: 0, top: 0, width: 0, height: 0 }
  private currentCrop: CropBox | null = null

  // Handle sizes
  private handleSize = 12
  private handleHitArea = 16

  /**
   * Attach to a canvas element
   */
  attach(
    canvas: HTMLCanvasElement,
    callbacks: InteractionCallbacks
  ): () => void {
    this.canvas = canvas
    this.callbacks = callbacks

    // Bind event handlers
    const onMouseDown = this.handleMouseDown.bind(this)
    const onMouseMove = this.handleMouseMove.bind(this)
    const onMouseUp = this.handleMouseUp.bind(this)
    const onTouchStart = this.handleTouchStart.bind(this)
    const onTouchMove = this.handleTouchMove.bind(this)
    const onTouchEnd = this.handleTouchEnd.bind(this)

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)

    // Return cleanup function
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      this.canvas = null
      this.callbacks = null
    }
  }

  /**
   * Set interaction mode
   */
  setMode(mode: InteractionMode): void {
    this.mode = mode
    if (mode !== 'crop') {
      this.currentCrop = null
    }
  }

  /**
   * Set current crop (for editing)
   */
  setCrop(crop: CropBox | null): void {
    this.currentCrop = crop ? { ...crop } : null
  }

  /**
   * Set image rectangle (position on canvas)
   */
  setImageRect(rect: ImageRect): void {
    this.imageRect = { ...rect }
  }

  /**
   * Check if currently dragging
   */
  isDragging(): boolean {
    return this.dragState.isDragging
  }

  // ============================================
  // MOUSE HANDLERS
  // ============================================

  private handleMouseDown(e: MouseEvent): void {
    if (this.mode === 'none') return
    
    e.preventDefault()
    const pos = this.getCanvasPosition(e.clientX, e.clientY)
    this.startDrag(pos.x, pos.y)
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragState.isDragging) {
      // Update cursor
      if (this.mode === 'crop' && this.currentCrop) {
        const pos = this.getCanvasPosition(e.clientX, e.clientY)
        this.updateCursor(pos.x, pos.y)
      }
      return
    }

    e.preventDefault()
    const pos = this.getCanvasPosition(e.clientX, e.clientY)
    this.continueDrag(pos.x, pos.y)
  }

  private handleMouseUp(e: MouseEvent): void {
    if (this.dragState.isDragging) {
      e.preventDefault()
      this.endDrag()
    }
  }

  // ============================================
  // TOUCH HANDLERS
  // ============================================

  private handleTouchStart(e: TouchEvent): void {
    if (this.mode === 'none') return
    if (e.touches.length !== 1) return

    e.preventDefault()
    const touch = e.touches[0]
    const pos = this.getCanvasPosition(touch.clientX, touch.clientY)
    this.startDrag(pos.x, pos.y)
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.dragState.isDragging) return
    if (e.touches.length !== 1) return

    e.preventDefault()
    const touch = e.touches[0]
    const pos = this.getCanvasPosition(touch.clientX, touch.clientY)
    this.continueDrag(pos.x, pos.y)
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (this.dragState.isDragging) {
      e.preventDefault()
      this.endDrag()
    }
  }

  // ============================================
  // DRAG LOGIC
  // ============================================

  private startDrag(x: number, y: number): void {
    if (this.mode === 'crop') {
      const handle = this.getHandleAtPosition(x, y)
      
      if (handle || this.isInsideCrop(x, y)) {
        this.dragState = {
          isDragging: true,
          handle: handle || 'move',
          startX: x,
          startY: y,
          startCrop: this.currentCrop ? { ...this.currentCrop } : null
        }
      } else {
        // Start new crop
        const normalized = this.pixelToNormalized(x, y)
        this.currentCrop = {
          x: normalized.x,
          y: normalized.y,
          width: 0,
          height: 0
        }
        this.dragState = {
          isDragging: true,
          handle: 'se', // Draw from top-left to bottom-right
          startX: x,
          startY: y,
          startCrop: { ...this.currentCrop }
        }
      }
    } else if (this.mode === 'pan') {
      this.dragState = {
        isDragging: true,
        handle: 'move',
        startX: x,
        startY: y,
        startCrop: null
      }
    }
  }

  private continueDrag(x: number, y: number): void {
    if (!this.dragState.isDragging) return

    if (this.mode === 'crop' && this.dragState.startCrop) {
      const newCrop = this.calculateNewCrop(x, y)
      if (newCrop) {
        this.currentCrop = newCrop
        this.callbacks?.onCropChange(newCrop)
      }
    } else if (this.mode === 'pan') {
      const dx = x - this.dragState.startX
      const dy = y - this.dragState.startY
      this.callbacks?.onPan(dx, dy)
      this.dragState.startX = x
      this.dragState.startY = y
    }
  }

  private endDrag(): void {
    if (this.mode === 'crop' && this.currentCrop) {
      // Normalize crop (ensure positive width/height)
      const normalized = this.normalizeCropBox(this.currentCrop)
      if (normalized.width > 0.01 && normalized.height > 0.01) {
        this.currentCrop = normalized
        this.callbacks?.onCropComplete(normalized)
      }
    } else if (this.mode === 'pan') {
      this.callbacks?.onPanComplete()
    }

    this.dragState = {
      isDragging: false,
      handle: null,
      startX: 0,
      startY: 0,
      startCrop: null
    }
  }

  // ============================================
  // COORDINATE HELPERS
  // ============================================

  private getCanvasPosition(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.canvas) return { x: 0, y: 0 }

    const rect = this.canvas.getBoundingClientRect()
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    }
  }

  private pixelToNormalized(x: number, y: number): { x: number; y: number } {
    const relX = (x - this.imageRect.left) / this.imageRect.width
    const relY = (y - this.imageRect.top) / this.imageRect.height
    return {
      x: Math.max(0, Math.min(1, relX)),
      y: Math.max(0, Math.min(1, relY))
    }
  }

  private normalizedToPixel(nx: number, ny: number): { x: number; y: number } {
    return {
      x: this.imageRect.left + nx * this.imageRect.width,
      y: this.imageRect.top + ny * this.imageRect.height
    }
  }

  // ============================================
  // CROP HELPERS
  // ============================================

  private getHandleAtPosition(x: number, y: number): DragHandle | null {
    if (!this.currentCrop) return null

    const crop = this.currentCrop
    const corners = [
      { handle: 'nw' as DragHandle, nx: crop.x, ny: crop.y },
      { handle: 'ne' as DragHandle, nx: crop.x + crop.width, ny: crop.y },
      { handle: 'sw' as DragHandle, nx: crop.x, ny: crop.y + crop.height },
      { handle: 'se' as DragHandle, nx: crop.x + crop.width, ny: crop.y + crop.height }
    ]

    const edges = [
      { handle: 'n' as DragHandle, nx: crop.x + crop.width / 2, ny: crop.y },
      { handle: 's' as DragHandle, nx: crop.x + crop.width / 2, ny: crop.y + crop.height },
      { handle: 'w' as DragHandle, nx: crop.x, ny: crop.y + crop.height / 2 },
      { handle: 'e' as DragHandle, nx: crop.x + crop.width, ny: crop.y + crop.height / 2 }
    ]

    // Check corners first (higher priority)
    for (const corner of corners) {
      const pos = this.normalizedToPixel(corner.nx, corner.ny)
      if (Math.abs(x - pos.x) < this.handleHitArea && Math.abs(y - pos.y) < this.handleHitArea) {
        return corner.handle
      }
    }

    // Then edges
    for (const edge of edges) {
      const pos = this.normalizedToPixel(edge.nx, edge.ny)
      if (Math.abs(x - pos.x) < this.handleHitArea && Math.abs(y - pos.y) < this.handleHitArea) {
        return edge.handle
      }
    }

    return null
  }

  private isInsideCrop(x: number, y: number): boolean {
    if (!this.currentCrop) return false

    const normalized = this.pixelToNormalized(x, y)
    const crop = this.currentCrop

    return (
      normalized.x >= crop.x &&
      normalized.x <= crop.x + crop.width &&
      normalized.y >= crop.y &&
      normalized.y <= crop.y + crop.height
    )
  }

  private calculateNewCrop(x: number, y: number): CropBox | null {
    const startCrop = this.dragState.startCrop
    if (!startCrop) return null

    const normalized = this.pixelToNormalized(x, y)
    const startNorm = this.pixelToNormalized(this.dragState.startX, this.dragState.startY)
    const dx = normalized.x - startNorm.x
    const dy = normalized.y - startNorm.y

    let newCrop = { ...startCrop }

    switch (this.dragState.handle) {
      case 'move':
        newCrop.x = Math.max(0, Math.min(1 - startCrop.width, startCrop.x + dx))
        newCrop.y = Math.max(0, Math.min(1 - startCrop.height, startCrop.y + dy))
        break

      case 'nw':
        newCrop.x = startCrop.x + dx
        newCrop.y = startCrop.y + dy
        newCrop.width = startCrop.width - dx
        newCrop.height = startCrop.height - dy
        break

      case 'ne':
        newCrop.y = startCrop.y + dy
        newCrop.width = startCrop.width + dx
        newCrop.height = startCrop.height - dy
        break

      case 'sw':
        newCrop.x = startCrop.x + dx
        newCrop.width = startCrop.width - dx
        newCrop.height = startCrop.height + dy
        break

      case 'se':
        newCrop.width = startCrop.width + dx
        newCrop.height = startCrop.height + dy
        break

      case 'n':
        newCrop.y = startCrop.y + dy
        newCrop.height = startCrop.height - dy
        break

      case 's':
        newCrop.height = startCrop.height + dy
        break

      case 'w':
        newCrop.x = startCrop.x + dx
        newCrop.width = startCrop.width - dx
        break

      case 'e':
        newCrop.width = startCrop.width + dx
        break
    }

    return newCrop
  }

  private normalizeCropBox(crop: CropBox): CropBox {
    let { x, y, width, height } = crop

    // Handle negative dimensions
    if (width < 0) {
      x = x + width
      width = -width
    }
    if (height < 0) {
      y = y + height
      height = -height
    }

    // Clamp to bounds
    x = Math.max(0, Math.min(1, x))
    y = Math.max(0, Math.min(1, y))
    width = Math.max(0, Math.min(1 - x, width))
    height = Math.max(0, Math.min(1 - y, height))

    return { x, y, width, height }
  }

  private updateCursor(x: number, y: number): void {
    if (!this.canvas) return

    const handle = this.getHandleAtPosition(x, y)
    
    if (handle) {
      const cursors: Record<DragHandle, string> = {
        nw: 'nwse-resize',
        ne: 'nesw-resize',
        sw: 'nesw-resize',
        se: 'nwse-resize',
        n: 'ns-resize',
        s: 'ns-resize',
        e: 'ew-resize',
        w: 'ew-resize',
        move: 'move'
      }
      this.canvas.style.cursor = cursors[handle]
    } else if (this.isInsideCrop(x, y)) {
      this.canvas.style.cursor = 'move'
    } else {
      this.canvas.style.cursor = 'crosshair'
    }
  }

  /**
   * Get handle positions for rendering
   */
  getHandlePositions(): Array<{ x: number; y: number; type: DragHandle }> {
    if (!this.currentCrop) return []

    const crop = this.currentCrop
    return [
      { ...this.normalizedToPixel(crop.x, crop.y), type: 'nw' as DragHandle },
      { ...this.normalizedToPixel(crop.x + crop.width, crop.y), type: 'ne' as DragHandle },
      { ...this.normalizedToPixel(crop.x, crop.y + crop.height), type: 'sw' as DragHandle },
      { ...this.normalizedToPixel(crop.x + crop.width, crop.y + crop.height), type: 'se' as DragHandle }
    ]
  }

  /**
   * Get handle size
   */
  getHandleSize(): number {
    return this.handleSize
  }
}
