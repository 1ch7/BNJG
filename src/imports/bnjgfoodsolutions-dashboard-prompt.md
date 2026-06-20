# Prompt: BNJGFoodSolutions — Interactive Dashboard Prototype

Act as an expert Senior React Developer and UI/UX Designer. Build a comprehensive, interactive, single-page dashboard prototype for a web app called **BNJGFoodSolutions** — a tool that helps restaurant managers reduce food waste from unused or over-prepared stock using AI analysis and dynamic inventory management.

## Tech Stack
- React (functional components + hooks)
- Tailwind CSS for all styling
- `lucide-react` for icons
- `recharts` for data visualization
- All React state — no backend, no external data fetching. Everything is mocked.

## Theme & UI Guidelines
- **Palette:** clean and eco-friendly — crisp whites, slate grays, energetic greens (fresh food / waste reduction), with warm amber/red accents reserved for overstock alerts.
- **Layout:** sidebar navigation + main content area.
- **State management:** React state drives navigation between views and simulates the full working flow (no real routing needed).
- Use realistic, appetizing restaurant mock data throughout (tomatoes, basil, pizza dough, mozzarella, steaks, olive oil, etc.) — nothing generic like "Item A."

## Required Flow & Features

### 1. Authentication & Onboarding (initial state)
- Elegant Login / Create Account screen for the Restaurant Manager.
- After "logging in," move to an onboarding step: **"Upload Cookbook (SOP)."**
- Drag-and-drop file upload zone. After "upload," show a success state confirming the app extracted and analyzed ingredients for each menu item.

### 2. Feature 1 — Daily Sales Report & Weekly Forecasting
- View for uploading the Daily Sales file, with a visual progress indicator for the current week (e.g., "4/7 days uploaded").
- Below the upload area, an **"AI Stock Suggestions for Next Week"** panel: a table listing ingredient, current stock, and AI-suggested order amount based on the week's sales data.

### 3. Feature 2 — Overstock Alerts & Discount Initiatives
- Dedicated **"Inventory Alerts"** dashboard.
- Logic: cross-reference current stock against the Cookbook SOP to flag overstock.
- Alert cards for overstocked items (e.g., "High Overstock: Tomatoes") with an actionable **"Generate Discount Initiative"** button.
- Clicking it opens a modal/expanded view with a specific suggestion (e.g., "Offer 15% off Margherita Pizza to move tomato stock").

### 4. Feature 3 — Smart Trend Detection (LLM Algorithm Insights)
- **"Analytics & Trends"** view built with `recharts`.
- Chart 1: correlation between Weather/Temperature and Customer Volume.
- Chart 2: peak times by Day of the Week.
- An **"LLM Insights"** text panel summarizing patterns in plain language (e.g., "Rainy days show a 30% drop in foot traffic but a 40% increase in soup orders — stock suggestions adjusted accordingly").

## Technical Requirements
- Bundle everything into one cohesive, interactive file/component.
- Use standard `lucide-react` icons throughout.
- Navigation between Dashboard, Uploads, Alerts, and Analytics must actually work via state — no dead links or static mockup screens.
- Prototype should feel production-ready: polished spacing, consistent component styling, sensible empty/loading/success states where relevant.

## Deliverable
Complete, runnable React code for this prototype — single component or cleanly organized into local sub-components within the same file, ready to drop into a Claude Design / artifact environment.
