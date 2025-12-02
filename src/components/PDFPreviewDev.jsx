import { useState, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react'

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

export default function PDFPreviewDev({ pdfBytes }) {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [selectedPage, setSelectedPage] = useState(null)
  const [modalZoom, setModalZoom] = useState(1)

  useEffect(() => {
    if (!pdfBytes) return

    const loadPDF = async () => {
      try {
        setLoading(true)
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytes })
        const pdf = await loadingTask.promise
        
        const totalPages = Math.min(4, pdf.numPages)
        const pagePromises = []

        for (let i = 1; i <= totalPages; i++) {
          pagePromises.push(renderPage(pdf, i))
        }

        const renderedPages = await Promise.all(pagePromises)
        setPages(renderedPages)
        setLoading(false)
      } catch (error) {
        console.error('Error loading PDF preview:', error)
        setLoading(false)
      }
    }

    loadPDF()
  }, [pdfBytes])

  const renderPage = async (pdf, pageNum) => {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1.5 })
    
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    canvas.width = viewport.width
    canvas.height = viewport.height

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise

    return {
      pageNum,
      dataUrl: canvas.toDataURL('image/jpeg', 0.8),
      width: viewport.width,
      height: viewport.height
    }
  }

  const openPage = (page) => {
    setSelectedPage(page)
    setModalZoom(1)
  }

  const closePage = () => {
    setSelectedPage(null)
    setModalZoom(1)
  }

  const nextPage = () => {
    if (selectedPage) {
      const currentIndex = pages.findIndex(p => p.pageNum === selectedPage.pageNum)
      if (currentIndex < pages.length - 1) {
        setSelectedPage(pages[currentIndex + 1])
        setModalZoom(1)
      }
    }
  }

  const prevPage = () => {
    if (selectedPage) {
      const currentIndex = pages.findIndex(p => p.pageNum === selectedPage.pageNum)
      if (currentIndex > 0) {
        setSelectedPage(pages[currentIndex - 1])
        setModalZoom(1)
      }
    }
  }

  if (!pdfBytes) return null

  return (
    <>
      <div className="mt-6 p-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-yellow-800">
            🔧 DEV PREVIEW: Generated PDF (First 4 Pages)
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
              className="px-2 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700"
            >
              −
            </button>
            <span className="text-xs text-yellow-800 font-mono">{(zoom * 100).toFixed(0)}%</span>
            <button
              onClick={() => setZoom(Math.min(2, zoom + 0.25))}
              className="px-2 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700"
            >
              +
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-yellow-700">
            <div className="animate-spin inline-block w-8 h-8 border-4 border-yellow-600 border-t-transparent rounded-full mb-2"></div>
            <p className="text-sm">Rendering PDF preview...</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto bg-white p-3 rounded">
            {pages.map((page) => (
              <div 
                key={page.pageNum} 
                className="border border-gray-300 rounded overflow-hidden cursor-pointer hover:border-yellow-500 hover:shadow-lg transition-all"
                onClick={() => openPage(page)}
              >
                <div className="bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 flex items-center justify-between">
                  <span>Page {page.pageNum}</span>
                  <span className="text-yellow-600 text-xs">Click to enlarge</span>
                </div>
                <div className="bg-white p-2 flex items-center justify-center">
                  <img
                    src={page.dataUrl}
                    alt={`Page ${page.pageNum}`}
                    style={{
                      maxWidth: '100%',
                      height: 'auto'
                    }}
                    className="border border-gray-200"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-yellow-700 mt-2 italic">
          ⚠️ This preview is for development only. Remove before production.
        </p>
      </div>

      {/* Full-size Modal */}
      {selectedPage && (
        <div 
          className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4"
          onClick={closePage}
        >
          <div 
            className="relative max-w-7xl max-h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Controls */}
            <div className="absolute top-0 left-0 right-0 bg-yellow-600 text-white px-4 py-3 rounded-t-lg flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <span className="font-bold">Page {selectedPage.pageNum} of 4</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setModalZoom(Math.max(0.5, modalZoom - 0.25))}
                    className="p-1.5 bg-yellow-700 rounded hover:bg-yellow-800 transition-colors"
                    title="Zoom out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-mono min-w-[50px] text-center">
                    {(modalZoom * 100).toFixed(0)}%
                  </span>
                  <button
                    onClick={() => setModalZoom(Math.min(3, modalZoom + 0.25))}
                    className="p-1.5 bg-yellow-700 rounded hover:bg-yellow-800 transition-colors"
                    title="Zoom in"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <button
                onClick={closePage}
                className="p-1.5 bg-yellow-700 rounded hover:bg-yellow-800 transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Image Container with scroll */}
            <div className="bg-gray-900 rounded-lg mt-14 overflow-auto max-h-[calc(100vh-120px)]">
              <img
                src={selectedPage.dataUrl}
                alt={`Page ${selectedPage.pageNum}`}
                style={{
                  width: `${selectedPage.width * modalZoom}px`,
                  height: `${selectedPage.height * modalZoom}px`
                }}
                className="mx-auto"
              />
            </div>

            {/* Navigation Arrows */}
            {pages.length > 1 && (
              <>
                {selectedPage.pageNum > 1 && (
                  <button
                    onClick={prevPage}
                    className="absolute left-4 top-1/2 -translate-y-1/2 bg-yellow-600 text-white p-3 rounded-full hover:bg-yellow-700 transition-colors shadow-lg"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                )}
                {selectedPage.pageNum < pages.length && (
                  <button
                    onClick={nextPage}
                    className="absolute right-4 top-1/2 -translate-y-1/2 bg-yellow-600 text-white p-3 rounded-full hover:bg-yellow-700 transition-colors shadow-lg"
                    title="Next page"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
