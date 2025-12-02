/**
 * ProgressBus
 * 
 * Simple event emitter for progress events.
 * Used by controller to report loading progress, export progress, etc.
 */

export type ProgressEventType = 
  | 'loadStart'
  | 'loadProgress'
  | 'loadComplete'
  | 'loadError'
  | 'exportStart'
  | 'exportProgress'
  | 'exportComplete'
  | 'exportError'
  | 'renderStart'
  | 'renderProgress'
  | 'renderComplete'
  | 'operationStart'
  | 'operationComplete'

export interface ProgressEvent {
  type: ProgressEventType
  progress?: number      // 0-100
  message?: string
  pageNumber?: number
  totalPages?: number
  error?: Error
  data?: unknown
}

export type ProgressListener = (event: ProgressEvent) => void

export class ProgressBus {
  private listeners: Map<ProgressEventType | '*', Set<ProgressListener>> = new Map()

  /**
   * Subscribe to a specific event type
   * Use '*' to subscribe to all events
   */
  on(eventType: ProgressEventType | '*', listener: ProgressListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(listener)

    // Return unsubscribe function
    return () => this.off(eventType, listener)
  }

  /**
   * Unsubscribe from an event type
   */
  off(eventType: ProgressEventType | '*', listener: ProgressListener): void {
    const listeners = this.listeners.get(eventType)
    if (listeners) {
      listeners.delete(listener)
    }
  }

  /**
   * Emit an event
   */
  emit(event: ProgressEvent): void {
    // Notify specific listeners
    const specificListeners = this.listeners.get(event.type)
    if (specificListeners) {
      specificListeners.forEach(listener => {
        try {
          listener(event)
        } catch (e) {
          console.error('[ProgressBus] Listener error:', e)
        }
      })
    }

    // Notify wildcard listeners
    const wildcardListeners = this.listeners.get('*')
    if (wildcardListeners) {
      wildcardListeners.forEach(listener => {
        try {
          listener(event)
        } catch (e) {
          console.error('[ProgressBus] Listener error:', e)
        }
      })
    }
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.listeners.clear()
  }

  // ============================================
  // CONVENIENCE EMIT METHODS
  // ============================================

  emitLoadStart(): void {
    this.emit({ type: 'loadStart', progress: 0 })
  }

  emitLoadProgress(progress: number, pageNumber?: number, totalPages?: number): void {
    this.emit({ type: 'loadProgress', progress, pageNumber, totalPages })
  }

  emitLoadComplete(totalPages: number): void {
    this.emit({ type: 'loadComplete', progress: 100, totalPages })
  }

  emitLoadError(error: Error): void {
    this.emit({ type: 'loadError', error, message: error.message })
  }

  emitExportStart(): void {
    this.emit({ type: 'exportStart', progress: 0 })
  }

  emitExportProgress(progress: number): void {
    this.emit({ type: 'exportProgress', progress })
  }

  emitExportComplete(): void {
    this.emit({ type: 'exportComplete', progress: 100 })
  }

  emitExportError(error: Error): void {
    this.emit({ type: 'exportError', error, message: error.message })
  }

  emitRenderStart(pageNumber: number): void {
    this.emit({ type: 'renderStart', pageNumber })
  }

  emitRenderProgress(pageNumber: number, progress: number): void {
    this.emit({ type: 'renderProgress', pageNumber, progress })
  }

  emitRenderComplete(pageNumber: number): void {
    this.emit({ type: 'renderComplete', pageNumber, progress: 100 })
  }

  emitOperation(message: string): void {
    this.emit({ type: 'operationStart', message })
  }

  emitOperationComplete(message?: string): void {
    this.emit({ type: 'operationComplete', message })
  }
}
