# PrintFlow Pro - Web Application

A modern web application connecting users with local print shops. Upload documents, customize print settings, get instant pricing, and place orders for local pickup.

## 🚀 Quick Start

### Prerequisites
- Node.js 20.x or higher
- Supabase account ([Sign up here](https://supabase.com))

### Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment Variables**
   
   Create a `.env` file in the root directory:
   ```bash
   cp .env.example .env
   ```
   
   Then edit `.env` and add your Supabase credentials:
   ```
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
   
   Get these from your [Supabase Dashboard](https://supabase.com/dashboard) → Project Settings → API

3. **Set Up Database**
   
   Run the migration file to create the required tables:
   - Navigate to your Supabase Dashboard → SQL Editor
   - Open and execute the SQL from `supabase/migrations/20250512000318_flat_sun.sql`
   - This creates the necessary tables: `shops`, `cost_configs`, `print_jobs`
   - Create a storage bucket named `print-files` with public access

4. **Start Development Server**
   ```bash
   npm run dev
   ```
   
   The app will be available at `http://localhost:5000`

## 🏗️ Project Structure

```
printflow-pro-web/
├── src/
│   ├── components/     # React components (PDF Editor, Image Editor, etc.)
│   ├── pages/          # Page components (Home, Shop, Order, Payment, Status)
│   ├── stores/         # Zustand state management
│   └── utils/          # Utility functions (PDF processing, Supabase client)
├── public/             # Static assets
├── supabase/           # Database migrations
└── vite.config.ts      # Vite configuration
```

## 🛠️ Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite 5
- **Styling**: Tailwind CSS
- **Routing**: React Router v6
- **State Management**: Zustand
- **PDF Processing**: pdf-lib, pdfjs-dist
- **Backend**: Supabase (PostgreSQL, Storage, Realtime)
- **Icons**: Lucide React
- **Notifications**: React Hot Toast

## 📦 Build & Deploy

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

### Deploy on Replit
This project is configured for Replit deployment:
- Development server runs on port 5000
- Environment variables can be set in Replit Secrets
- Click "Deploy" in Replit to publish to production

## 🔑 Key Features

- **PDF & Image Upload**: Support for various document formats
- **Advanced PDF Editor**: Rotate, crop, select pages, N-up printing
- **Real-time Pricing**: Dynamic cost calculation based on print settings
- **Print Customization**: Paper size, color mode, single/double-sided, copies
- **Order Tracking**: Real-time status updates via Supabase subscriptions
- **Mobile-First Design**: Optimized for all devices
- **Performance Optimized**: Lazy loading, efficient canvas operations, LRU caching

## 📝 License

Private - All rights reserved

## 🤝 Contributing

This is a private project. For questions or support, contact the project owner.
