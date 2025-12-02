# PrintFlow Pro - Web Application

## Overview
PrintFlow Pro is a modern React web application designed to connect users with local print shops. It enables users to upload documents (PDFs and images), customize print settings, receive instant pricing, and place orders for local pickup. The project aims to streamline the print ordering process, offering advanced editing capabilities for both PDFs and images, real-time pricing, and order tracking.

## User Preferences
No specific user preferences were provided in the original document.

## System Architecture
PrintFlow Pro is built with a React 18 frontend using TypeScript and Vite 5, styled with Tailwind CSS, and uses React Router v6 for navigation and Zustand for state management. PDF processing is handled by `pdf-lib` and `pdfjs-dist`. The backend and database are powered by Supabase, utilizing PostgreSQL, Storage, and Realtime features.

**Key Features:**
- PDF & Image Upload with drag-and-drop.
- Advanced PDF Editor supporting rotation, cropping, page selection, and N-up printing.
- Advanced Image Editor for brightness, contrast, scaling, and cropping.
- Real-time pricing calculations based on print customization.
- Print customization options including paper size, color mode, duplex printing, and copies.
- Order tracking with real-time status updates via Supabase subscriptions.
- Mobile-first responsive design.
- Performance optimizations through lazy loading and efficient canvas operations.

**Project Structure and PDF Editor Architecture:**
The application's `src` directory is organized into `components`, `pages`, `stores`, and `utils`. A significant architectural decision involves a modular adapter system for PDF processing, allowing for gradual migration to a new, more modular `pdf2/` architecture without breaking existing functionalities. This new architecture organizes PDF-related logic into `edits/`, `services/`, `state/`, `ui/`, and `controller/` modules, emphasizing clear separation of concerns and improved maintainability. The design principle for the web app's PDF editor is "VISUAL PREVIEW ONLY," with actual PDF rendering and transformation handled by a desktop print engine.

The system addresses cross-component coordination challenges in PDF rendering using a module-level synchronous blocking flag in `pdfStore.js` to prevent concurrent `pdf.js` canvas access conflicts, ensuring consistent state across components. UI logic for the PDF editor, including crop, rotation, and canvas interaction handlers, has been extensively extracted into modular `pdf2/ui/` files, delegating pure mathematical functions and interaction state management away from the main `PDFEditor.jsx` component.

The transformation pipeline adheres to a strict order of operations: CROP → ROTATE → SCALE → OFFSET, ensuring correct handling of all print customization combinations.

**Environment Configuration:**
The application requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to be configured as environment variables.

## External Dependencies
- **Frontend Framework:** React 18
- **Build Tool:** Vite 5
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Routing:** React Router v6
- **State Management:** Zustand
- **PDF Processing Libraries:** `pdf-lib`, `pdfjs-dist`
- **Backend & Database:** Supabase (PostgreSQL, Storage, Realtime)
- **Icons:** Lucide React
- **Notifications:** React Hot Toast