/**
 * PageState
 * 
 * Manages arrays of pages: page order, inclusion/exclusion, reordering.
 * Stores the list of pages from the PDF and their current order.
 */

import { PageInfo, PageDimensions } from '../types'

export class PageState {
  private pages: PageInfo[] = []
  private excludedPages: Set<number> = new Set()
  private totalPages: number = 0
  private documentId: string = ''

  /**
   * Initialize with pages from loaded PDF
   */
  init(pageInfos: PageInfo[], documentId: string): void {
    this.pages = [...pageInfos]
    this.totalPages = pageInfos.length
    this.documentId = documentId
    this.excludedPages.clear()
  }

  /**
   * Get all pages (includes excluded pages too)
   */
  getAll(): PageInfo[] {
    return [...this.pages]
  }

  /**
   * Get only included pages (not excluded)
   */
  getIncluded(): PageInfo[] {
    return this.pages.filter(p => !this.excludedPages.has(p.pageNumber))
  }

  /**
   * Get excluded page numbers
   */
  getExcluded(): number[] {
    return Array.from(this.excludedPages)
  }

  /**
   * Get page by original page number
   */
  getPage(pageNumber: number): PageInfo | null {
    return this.pages.find(p => p.pageNumber === pageNumber) || null
  }

  /**
   * Get page by index in current order
   */
  getPageByIndex(index: number): PageInfo | null {
    return this.pages[index] || null
  }

  /**
   * Get total page count
   */
  getTotalPages(): number {
    return this.totalPages
  }

  /**
   * Get included page count
   */
  getIncludedCount(): number {
    return this.totalPages - this.excludedPages.size
  }

  /**
   * Get document ID
   */
  getDocumentId(): string {
    return this.documentId
  }

  // ============================================
  // PAGE ORDER OPERATIONS
  // ============================================

  /**
   * Reorder pages: move page from fromIndex to toIndex
   */
  reorder(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.pages.length) return
    if (toIndex < 0 || toIndex >= this.pages.length) return
    if (fromIndex === toIndex) return

    const [removed] = this.pages.splice(fromIndex, 1)
    this.pages.splice(toIndex, 0, removed)
  }

  /**
   * Get current order as array of page numbers
   */
  getOrder(): number[] {
    return this.pages.map(p => p.pageNumber)
  }

  /**
   * Set custom order
   */
  setOrder(pageNumbers: number[]): void {
    const pageMap = new Map(this.pages.map(p => [p.pageNumber, p]))
    this.pages = pageNumbers
      .map(num => pageMap.get(num))
      .filter((p): p is PageInfo => p !== undefined)
  }

  /**
   * Reset to original order
   */
  resetOrder(): void {
    this.pages.sort((a, b) => a.pageNumber - b.pageNumber)
  }

  // ============================================
  // INCLUDE/EXCLUDE OPERATIONS
  // ============================================

  /**
   * Exclude a page from output
   */
  excludePage(pageNumber: number): void {
    this.excludedPages.add(pageNumber)
  }

  /**
   * Include a previously excluded page
   */
  includePage(pageNumber: number): void {
    this.excludedPages.delete(pageNumber)
  }

  /**
   * Toggle page inclusion
   */
  togglePage(pageNumber: number): boolean {
    if (this.excludedPages.has(pageNumber)) {
      this.excludedPages.delete(pageNumber)
      return true // now included
    } else {
      this.excludedPages.add(pageNumber)
      return false // now excluded
    }
  }

  /**
   * Check if page is included
   */
  isIncluded(pageNumber: number): boolean {
    return !this.excludedPages.has(pageNumber)
  }

  /**
   * Check if page is excluded
   */
  isExcluded(pageNumber: number): boolean {
    return this.excludedPages.has(pageNumber)
  }

  /**
   * Include all pages
   */
  includeAll(): void {
    this.excludedPages.clear()
  }

  /**
   * Exclude all pages
   */
  excludeAll(): void {
    this.pages.forEach(p => this.excludedPages.add(p.pageNumber))
  }

  // ============================================
  // PAGE INFO HELPERS
  // ============================================

  /**
   * Get dimensions for a page
   */
  getDimensions(pageNumber: number): PageDimensions | null {
    const page = this.getPage(pageNumber)
    return page ? { width: page.width, height: page.height } : null
  }

  /**
   * Check if page exists
   */
  hasPage(pageNumber: number): boolean {
    return this.pages.some(p => p.pageNumber === pageNumber)
  }

  /**
   * Get index of page in current order
   */
  getIndex(pageNumber: number): number {
    return this.pages.findIndex(p => p.pageNumber === pageNumber)
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.pages = []
    this.excludedPages.clear()
    this.totalPages = 0
    this.documentId = ''
  }

  /**
   * Check if has any pages
   */
  isEmpty(): boolean {
    return this.pages.length === 0
  }

  /**
   * Get pages in range (1-indexed, inclusive)
   */
  getRange(start: number, end: number): PageInfo[] {
    return this.pages.filter(p => p.pageNumber >= start && p.pageNumber <= end)
  }

  /**
   * Get odd pages
   */
  getOddPages(): PageInfo[] {
    return this.pages.filter(p => p.pageNumber % 2 === 1)
  }

  /**
   * Get even pages
   */
  getEvenPages(): PageInfo[] {
    return this.pages.filter(p => p.pageNumber % 2 === 0)
  }
}
