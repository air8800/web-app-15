import React from 'react'
import { AlertTriangle, X, Save } from 'lucide-react'

const UnsavedChangesPopup = ({ 
  isOpen, 
  onDiscard, 
  onSaveAndClose,
  title = "Unsaved Changes",
  message = "You have unsaved changes that will be lost if you close without saving."
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-scale-in">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4">
          <div className="flex items-center gap-3 text-white">
            <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-lg">{title}</h3>
              <p className="text-amber-100 text-sm">Please confirm your action</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-gray-700 text-sm leading-relaxed">
            {message}
          </p>
        </div>

        <div className="px-5 py-4 bg-gray-50 flex flex-col gap-2.5">
          <button
            onClick={onSaveAndClose}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg hover:from-violet-700 hover:to-violet-800 transition-all duration-200 shadow-md hover:shadow-lg"
          >
            <Save className="w-4 h-4" />
            Save & Close
          </button>
          <button
            onClick={onDiscard}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-all duration-200"
          >
            <X className="w-4 h-4" />
            Discard Changes
          </button>
        </div>
      </div>
    </div>
  )
}

export default UnsavedChangesPopup
