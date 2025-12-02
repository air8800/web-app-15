/**
 * RotationHandler
 * 
 * Handles all rotation-related logic for the PDF editor.
 * Extracted from PDFEditor.jsx for modularity.
 * 
 * Maps to old functions: rotateCanvas, handleRotationChange, resetSettings
 */

import { RotationDegrees } from '../types'

export type RotationDirection = 'cw' | 'ccw'

export interface RotationState {
  currentRotation: RotationDegrees
  pendingRotation: RotationDegrees
  hasChanges: boolean
}

export class RotationHandler {
  private state: RotationState = {
    currentRotation: 0,
    pendingRotation: 0,
    hasChanges: false
  }

  /**
   * Initialize rotation state for a page
   */
  initialize(existingRotation: RotationDegrees = 0): void {
    this.state = {
      currentRotation: existingRotation,
      pendingRotation: existingRotation,
      hasChanges: false
    }
  }

  /**
   * Get current rotation state
   */
  getState(): RotationState {
    return { ...this.state }
  }

  /**
   * Get current rotation in degrees
   */
  getRotation(): RotationDegrees {
    return this.state.pendingRotation
  }

  /**
   * Rotate by 90 degrees in specified direction
   * Maps to: rotateCanvas(direction)
   */
  rotate(direction: RotationDirection): RotationDegrees {
    const delta = direction === 'cw' ? 90 : -90
    const newRotation = this.normalizeRotation(this.state.pendingRotation + delta)
    
    this.state = {
      ...this.state,
      pendingRotation: newRotation,
      hasChanges: newRotation !== this.state.currentRotation
    }
    
    return newRotation
  }

  /**
   * Set rotation to specific value
   * Maps to: handleRotationChange(value)
   */
  setRotation(degrees: number): RotationDegrees {
    const normalized = this.normalizeRotation(degrees)
    
    this.state = {
      ...this.state,
      pendingRotation: normalized,
      hasChanges: normalized !== this.state.currentRotation
    }
    
    return normalized
  }

  /**
   * Reset rotation to original value
   * Maps to: resetSettings() for rotation part
   */
  reset(): RotationDegrees {
    this.state = {
      ...this.state,
      pendingRotation: this.state.currentRotation,
      hasChanges: false
    }
    
    return this.state.currentRotation
  }

  /**
   * Apply pending rotation (commit changes)
   */
  apply(): void {
    this.state = {
      currentRotation: this.state.pendingRotation,
      pendingRotation: this.state.pendingRotation,
      hasChanges: false
    }
  }

  /**
   * Check if rotation has unsaved changes
   */
  hasUnsavedChanges(): boolean {
    return this.state.hasChanges
  }

  /**
   * Normalize rotation to 0, 90, 180, or 270
   */
  normalizeRotation(degrees: number): RotationDegrees {
    const normalized = ((degrees % 360) + 360) % 360
    
    if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
      return normalized as RotationDegrees
    }
    
    if (normalized < 45) return 0
    if (normalized < 135) return 90
    if (normalized < 225) return 180
    if (normalized < 315) return 270
    return 0
  }

  /**
   * Get rotation as human-readable string
   */
  getRotationLabel(): string {
    switch (this.state.pendingRotation) {
      case 0: return 'No rotation'
      case 90: return '90° clockwise'
      case 180: return '180°'
      case 270: return '90° counter-clockwise'
      default: return `${this.state.pendingRotation}°`
    }
  }

  /**
   * Check if page is in portrait or landscape orientation
   * Takes into account current rotation
   */
  getOrientation(originalWidth: number, originalHeight: number): 'portrait' | 'landscape' {
    const isRotated90or270 = this.state.pendingRotation === 90 || this.state.pendingRotation === 270
    
    if (isRotated90or270) {
      return originalWidth > originalHeight ? 'portrait' : 'landscape'
    }
    
    return originalWidth < originalHeight ? 'portrait' : 'landscape'
  }

  /**
   * Get effective dimensions after rotation
   */
  getEffectiveDimensions(
    originalWidth: number,
    originalHeight: number
  ): { width: number; height: number } {
    const isRotated90or270 = this.state.pendingRotation === 90 || this.state.pendingRotation === 270
    
    if (isRotated90or270) {
      return { width: originalHeight, height: originalWidth }
    }
    
    return { width: originalWidth, height: originalHeight }
  }

  /**
   * Rotate a canvas by a specific angle
   * EXACT COPY of legacy rotateCanvas from PDFEditor.jsx
   * 
   * @param sourceCanvas - The canvas to rotate
   * @param deltaRotation - Rotation delta in degrees (0, 90, 180, 270)
   * @returns A new canvas with the rotated content
   */
  rotateCanvas(sourceCanvas: HTMLCanvasElement, deltaRotation: number): HTMLCanvasElement {
    const normalizedDelta = ((deltaRotation % 360) + 360) % 360
    const isSwapped = normalizedDelta === 90 || normalizedDelta === 270
    
    // Create rotated canvas with swapped dimensions if needed
    const rotatedCanvas = document.createElement('canvas')
    if (isSwapped) {
      rotatedCanvas.width = sourceCanvas.height
      rotatedCanvas.height = sourceCanvas.width
    } else {
      rotatedCanvas.width = sourceCanvas.width
      rotatedCanvas.height = sourceCanvas.height
    }
    
    const ctx = rotatedCanvas.getContext('2d')
    if (!ctx) {
      console.error('Failed to get 2D context for rotated canvas')
      return sourceCanvas
    }
    
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, rotatedCanvas.width, rotatedCanvas.height)
    
    ctx.save()
    
    // Use direct translation + rotation for each case
    // This ensures the image is properly positioned after rotation
    if (normalizedDelta === 90) {
      // 90° clockwise: translate to top-right, then rotate
      ctx.translate(rotatedCanvas.width, 0)
      ctx.rotate(Math.PI / 2)
    } else if (normalizedDelta === 180) {
      // 180°: translate to bottom-right, then rotate
      ctx.translate(rotatedCanvas.width, rotatedCanvas.height)
      ctx.rotate(Math.PI)
    } else if (normalizedDelta === 270) {
      // 270° clockwise (90° counter-clockwise): translate to bottom-left, then rotate
      ctx.translate(0, rotatedCanvas.height)
      ctx.rotate(-Math.PI / 2)
    }
    // For 0° or 360°, no transformation needed
    
    ctx.drawImage(sourceCanvas, 0, 0)
    ctx.restore()
    
    return rotatedCanvas
  }

  /**
   * Calculate rotation delta needed to go from current to target rotation
   */
  getRotationDelta(targetRotation: RotationDegrees): number {
    const current = this.state.pendingRotation
    const delta = ((targetRotation - current) % 360 + 360) % 360
    return delta
  }

  /**
   * Calculate rotation delta needed to reset to 0°
   */
  getResetDelta(): number {
    return (360 - this.state.pendingRotation) % 360
  }
}
