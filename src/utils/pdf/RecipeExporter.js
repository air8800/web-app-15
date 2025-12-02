/**
 * RecipeExporter
 * 
 * Generates JSON recipes for the desktop print engine.
 * 
 * ARCHITECTURE:
 * - Web app = VISUAL PREVIEW ONLY
 * - Desktop print engine = actual PDF rendering/transformation
 * - This module generates the recipe that tells the desktop engine what to do
 * 
 * The recipe contains:
 * - Page-by-page transformation instructions
 * - Print settings (paper size, color mode, copies, etc.)
 * - Original file reference (not embedded, just metadata)
 */

/**
 * Generate a complete print job recipe
 * 
 * @param {Object} options - Recipe options
 * @param {Object} options.file - Original file metadata (name, size, type)
 * @param {Array} options.pages - Array of page objects with editHistory
 * @param {Object} options.printSettings - Print configuration
 * @param {string} options.shopId - Target print shop ID
 * @returns {Object} Complete recipe for desktop print engine
 */
export function generatePrintRecipe(options) {
  const { file, pages, printSettings, shopId } = options
  
  const recipe = {
    version: '1.0',
    type: 'print_job',
    generatedAt: new Date().toISOString(),
    
    // File reference (desktop engine loads original file)
    source: {
      fileName: file?.name || 'unknown.pdf',
      fileSize: file?.size || 0,
      fileType: file?.type || 'application/pdf',
      totalPages: pages?.length || 0
    },
    
    // Print configuration
    print: {
      paperSize: printSettings?.paperSize || 'A4',
      colorMode: printSettings?.colorMode || 'Color',
      duplex: printSettings?.duplex || false,
      copies: printSettings?.copies || 1,
      pagesPerSheet: printSettings?.pagesPerSheet || 1,
      quality: printSettings?.quality || 'standard'
    },
    
    // Per-page transformations
    pages: generatePageRecipes(pages),
    
    // Delivery info
    destination: {
      shopId: shopId || null
    }
  }
  
  return recipe
}

/**
 * Generate transformation recipe for each page
 */
function generatePageRecipes(pages) {
  if (!pages || !Array.isArray(pages)) return []
  
  return pages.map((page, index) => {
    const editHistory = page.editHistory || {}
    
    return {
      pageNumber: page.pageNumber || index + 1,
      originalDimensions: {
        width: page.width || 595,
        height: page.height || 842
      },
      
      // Transformation instructions for desktop engine
      transforms: {
        rotation: editHistory.rotation || 0,
        scale: editHistory.scale || 100,
        offsetX: editHistory.offsetX || 0,
        offsetY: editHistory.offsetY || 0,
        
        // Crop area in normalized coordinates (0-1)
        crop: editHistory.cropArea ? {
          x: editHistory.cropArea.x,
          y: editHistory.cropArea.y,
          width: editHistory.cropArea.width,
          height: editHistory.cropArea.height
        } : null
      },
      
      // Flags
      hasEdits: page.edited || false,
      isCropped: editHistory.isCropped || false,
      fitCropToPage: editHistory.fitCropToPage || false
    }
  })
}

/**
 * Validate a recipe before sending to print engine
 */
export function validateRecipe(recipe) {
  const errors = []
  
  if (!recipe.version) errors.push('Missing version')
  if (!recipe.source?.fileName) errors.push('Missing source file name')
  if (!recipe.pages || recipe.pages.length === 0) errors.push('No pages in recipe')
  
  // Validate each page
  recipe.pages?.forEach((page, index) => {
    if (page.transforms?.rotation && ![0, 90, 180, 270].includes(page.transforms.rotation)) {
      errors.push(`Page ${index + 1}: Invalid rotation ${page.transforms.rotation}`)
    }
    if (page.transforms?.scale && (page.transforms.scale < 10 || page.transforms.scale > 500)) {
      errors.push(`Page ${index + 1}: Invalid scale ${page.transforms.scale}`)
    }
    if (page.transforms?.crop) {
      const crop = page.transforms.crop
      if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) {
        errors.push(`Page ${index + 1}: Invalid crop area`)
      }
      if (crop.x + crop.width > 1.01 || crop.y + crop.height > 1.01) {
        errors.push(`Page ${index + 1}: Crop area exceeds bounds`)
      }
    }
  })
  
  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Convert recipe to JSON string for transmission
 */
export function serializeRecipe(recipe) {
  return JSON.stringify(recipe, null, 2)
}

/**
 * Parse recipe from JSON string
 */
export function deserializeRecipe(jsonString) {
  try {
    return JSON.parse(jsonString)
  } catch (e) {
    console.error('Failed to parse recipe:', e)
    return null
  }
}
