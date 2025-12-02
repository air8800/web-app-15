/**
 * SelectionState
 * 
 * Manages page selection for batch operations.
 * Tracks which pages are currently selected.
 */

export class SelectionState {
  private selected: Set<number> = new Set()
  private lastSelected: number | null = null

  /**
   * Select a single page
   */
  select(pageNumber: number): void {
    this.selected.add(pageNumber)
    this.lastSelected = pageNumber
  }

  /**
   * Deselect a page
   */
  deselect(pageNumber: number): void {
    this.selected.delete(pageNumber)
    if (this.lastSelected === pageNumber) {
      this.lastSelected = null
    }
  }

  /**
   * Toggle page selection
   */
  toggle(pageNumber: number): boolean {
    if (this.selected.has(pageNumber)) {
      this.deselect(pageNumber)
      return false
    } else {
      this.select(pageNumber)
      return true
    }
  }

  /**
   * Select only this page (clear others)
   */
  selectOnly(pageNumber: number): void {
    this.selected.clear()
    this.selected.add(pageNumber)
    this.lastSelected = pageNumber
  }

  /**
   * Select range of pages (inclusive)
   */
  selectRange(start: number, end: number): void {
    const [from, to] = start <= end ? [start, end] : [end, start]
    for (let i = from; i <= to; i++) {
      this.selected.add(i)
    }
    this.lastSelected = end
  }

  /**
   * Shift+click behavior: select from last to this
   */
  extendSelection(toPageNumber: number): void {
    if (this.lastSelected === null) {
      this.select(toPageNumber)
    } else {
      this.selectRange(this.lastSelected, toPageNumber)
    }
  }

  /**
   * Select all pages in range
   */
  selectAll(totalPages: number): void {
    for (let i = 1; i <= totalPages; i++) {
      this.selected.add(i)
    }
    this.lastSelected = totalPages
  }

  /**
   * Clear all selections
   */
  clearAll(): void {
    this.selected.clear()
    this.lastSelected = null
  }

  /**
   * Check if page is selected
   */
  isSelected(pageNumber: number): boolean {
    return this.selected.has(pageNumber)
  }

  /**
   * Get all selected page numbers (sorted)
   */
  getSelected(): number[] {
    return Array.from(this.selected).sort((a, b) => a - b)
  }

  /**
   * Get count of selected pages
   */
  getCount(): number {
    return this.selected.size
  }

  /**
   * Check if has any selection
   */
  hasSelection(): boolean {
    return this.selected.size > 0
  }

  /**
   * Check if has multiple selections
   */
  hasMultipleSelections(): boolean {
    return this.selected.size > 1
  }

  /**
   * Get first selected page
   */
  getFirst(): number | null {
    const sorted = this.getSelected()
    return sorted.length > 0 ? sorted[0] : null
  }

  /**
   * Get last selected page
   */
  getLast(): number | null {
    return this.lastSelected
  }

  /**
   * Invert selection
   */
  invert(totalPages: number): void {
    const newSelected = new Set<number>()
    for (let i = 1; i <= totalPages; i++) {
      if (!this.selected.has(i)) {
        newSelected.add(i)
      }
    }
    this.selected = newSelected
    this.lastSelected = null
  }

  /**
   * Select odd pages only
   */
  selectOdd(totalPages: number): void {
    this.selected.clear()
    for (let i = 1; i <= totalPages; i += 2) {
      this.selected.add(i)
    }
    this.lastSelected = null
  }

  /**
   * Select even pages only
   */
  selectEven(totalPages: number): void {
    this.selected.clear()
    for (let i = 2; i <= totalPages; i += 2) {
      this.selected.add(i)
    }
    this.lastSelected = null
  }

  /**
   * Filter selected pages by a predicate
   */
  filter(predicate: (pageNumber: number) => boolean): void {
    const filtered = new Set<number>()
    this.selected.forEach(p => {
      if (predicate(p)) {
        filtered.add(p)
      }
    })
    this.selected = filtered
  }
}
