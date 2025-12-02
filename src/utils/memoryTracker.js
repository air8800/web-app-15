const ENABLE_MEMORY_TRACKING = true

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getMemoryInfo = () => {
  if (performance.memory) {
    return {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
    }
  }
  return null
}

class MemoryTracker {
  constructor(componentName = 'PDFEditor') {
    this.componentName = componentName
    this.snapshots = []
    this.baselineMemory = null
    this.enabled = ENABLE_MEMORY_TRACKING
  }

  takeSnapshot(label) {
    if (!this.enabled) return null
    
    const memory = getMemoryInfo()
    if (!memory) {
      console.warn('⚠️ Memory API not available (only works in Chrome with --enable-precise-memory-info flag)')
      return null
    }

    const snapshot = {
      label,
      timestamp: Date.now(),
      memory: { ...memory },
      usedMB: memory.usedJSHeapSize / (1024 * 1024),
      totalMB: memory.totalJSHeapSize / (1024 * 1024),
      limitMB: memory.jsHeapSizeLimit / (1024 * 1024)
    }

    if (!this.baselineMemory) {
      this.baselineMemory = snapshot.usedMB
      snapshot.deltaFromBaseline = 0
    } else {
      snapshot.deltaFromBaseline = snapshot.usedMB - this.baselineMemory
    }

    const prevSnapshot = this.snapshots[this.snapshots.length - 1]
    if (prevSnapshot) {
      snapshot.deltaFromPrevious = snapshot.usedMB - prevSnapshot.usedMB
    } else {
      snapshot.deltaFromPrevious = 0
    }

    this.snapshots.push(snapshot)

    const deltaSign = snapshot.deltaFromPrevious >= 0 ? '+' : ''
    const emoji = snapshot.deltaFromPrevious > 10 ? '🔴' : 
                  snapshot.deltaFromPrevious > 5 ? '🟡' : 
                  snapshot.deltaFromPrevious > 0 ? '🟢' : '⚪'

    console.log(
      `${emoji} [Memory] ${label}\n` +
      `   Used: ${snapshot.usedMB.toFixed(2)} MB | ` +
      `Delta: ${deltaSign}${snapshot.deltaFromPrevious.toFixed(2)} MB | ` +
      `Total from start: ${deltaSign}${snapshot.deltaFromBaseline.toFixed(2)} MB`
    )

    return snapshot
  }

  mark(label) {
    return this.takeSnapshot(label)
  }

  startOperation(operationName) {
    if (!this.enabled) return { end: () => {} }
    
    const startSnapshot = this.takeSnapshot(`${operationName} - START`)
    const startTime = performance.now()

    return {
      end: () => {
        const endSnapshot = this.takeSnapshot(`${operationName} - END`)
        const duration = performance.now() - startTime
        
        if (startSnapshot && endSnapshot) {
          const memoryUsed = endSnapshot.usedMB - startSnapshot.usedMB
          const emoji = memoryUsed > 20 ? '🔴🔴' : 
                        memoryUsed > 10 ? '🔴' : 
                        memoryUsed > 5 ? '🟡' : '🟢'
          
          console.log(
            `${emoji} [Memory] ${operationName} SUMMARY:\n` +
            `   Duration: ${duration.toFixed(0)} ms\n` +
            `   Memory Used: ${memoryUsed >= 0 ? '+' : ''}${memoryUsed.toFixed(2)} MB\n` +
            `   Final Heap: ${endSnapshot.usedMB.toFixed(2)} MB`
          )
        }
        
        return { duration, memoryUsed: endSnapshot?.usedMB - startSnapshot?.usedMB }
      }
    }
  }

  getSummary() {
    if (!this.enabled || this.snapshots.length === 0) return null

    const peakMemory = Math.max(...this.snapshots.map(s => s.usedMB))
    const totalDelta = this.snapshots[this.snapshots.length - 1].usedMB - this.baselineMemory

    const summary = {
      totalSnapshots: this.snapshots.length,
      baselineMemoryMB: this.baselineMemory,
      peakMemoryMB: peakMemory,
      finalMemoryMB: this.snapshots[this.snapshots.length - 1].usedMB,
      totalDeltaMB: totalDelta,
      snapshots: this.snapshots
    }

    console.log(
      `\n📊 [Memory Summary - ${this.componentName}]\n` +
      `   Baseline: ${this.baselineMemory.toFixed(2)} MB\n` +
      `   Peak: ${peakMemory.toFixed(2)} MB\n` +
      `   Final: ${summary.finalMemoryMB.toFixed(2)} MB\n` +
      `   Total Growth: ${totalDelta >= 0 ? '+' : ''}${totalDelta.toFixed(2)} MB\n`
    )

    return summary
  }

  reset() {
    this.snapshots = []
    this.baselineMemory = null
    console.log(`🔄 [Memory] Tracker reset for ${this.componentName}`)
  }

  printDetailedReport() {
    if (!this.enabled || this.snapshots.length === 0) {
      console.log('No memory snapshots recorded')
      return
    }

    console.log('\n' + '='.repeat(60))
    console.log(`📊 DETAILED MEMORY REPORT - ${this.componentName}`)
    console.log('='.repeat(60))
    
    console.log('\n📍 All Snapshots:')
    console.log('-'.repeat(60))
    
    this.snapshots.forEach((s, i) => {
      const emoji = s.deltaFromPrevious > 10 ? '🔴' : 
                    s.deltaFromPrevious > 5 ? '🟡' : 
                    s.deltaFromPrevious > 0 ? '🟢' : '⚪'
      
      console.log(
        `${i + 1}. ${emoji} ${s.label}\n` +
        `      Used: ${s.usedMB.toFixed(2)} MB | ` +
        `Step Delta: ${s.deltaFromPrevious >= 0 ? '+' : ''}${s.deltaFromPrevious.toFixed(2)} MB | ` +
        `Total Delta: ${s.deltaFromBaseline >= 0 ? '+' : ''}${s.deltaFromBaseline.toFixed(2)} MB`
      )
    })

    console.log('\n' + '-'.repeat(60))
    
    const topConsumers = [...this.snapshots]
      .sort((a, b) => b.deltaFromPrevious - a.deltaFromPrevious)
      .slice(0, 5)
      .filter(s => s.deltaFromPrevious > 0)

    if (topConsumers.length > 0) {
      console.log('\n🔝 Top Memory Consumers:')
      topConsumers.forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.label}: +${s.deltaFromPrevious.toFixed(2)} MB`)
      })
    }

    this.getSummary()
    console.log('='.repeat(60) + '\n')
  }
}

export const createMemoryTracker = (componentName) => new MemoryTracker(componentName)
export default MemoryTracker
