# BOL Data Extractor

An intelligent Bill of Lading (BOL) data extraction tool that uses Claude AI to automatically extract and calculate freight charges from PDF documents.

## Features

- 📄 Multi-page PDF processing
- 🤖 AI-powered data extraction using Claude Sonnet 4
- 💰 Automatic freight cost calculation
- 📊 Excel-compatible output (copy/paste or CSV download)
- ⚙️ Adjustable fuel surcharge settings
- 🎯 Smart detection of:
  - Liftgate requirements
  - Inside delivery
  - Residential delivery
  - Over-length charges
  - Time-specific delivery windows
  - Detention time
  - Debris removal (Lakeshore special handling)

## Project Structure

\`\`\`
bol-extractor-project/
├── frontend/          # React frontend application
├── backend/           # Node.js Express API server
└── README.md         # This file
\`\`\`

## Setup Instructions

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Anthropic API key

### Backend Setup

1. Navigate to the backend folder:
   \`\`\`bash
   cd backend
   \`\`\`

2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

3. Create a \`.env\` file:
   \`\`\`bash
   ANTHROPIC_API_KEY=your_api_key_here
   \`\`\`

4. Start the server:
   \`\`\`bash
   node server.js
   \`\`\`
   Server will run on \`http://localhost:3001\`

### Frontend Setup

1. Navigate to the frontend folder:
   \`\`\`bash
   cd frontend
   \`\`\`

2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

3. Start the development server:
   \`\`\`bash
   npm run dev
   \`\`\`
   App will run on \`http://localhost:5173\`

## Usage

1. Start both backend and frontend servers
2. Open the app in your browser
3. Upload one or more BOL PDF files
4. Click "Extract & Calculate"
5. Review results in the table
6. Copy to clipboard or download as CSV

## Technologies Used

- **Frontend**: React, Vite, Tailwind CSS, Lucide React
- **Backend**: Node.js, Express, Anthropic Claude API, pdf-lib
- **AI**: Claude Sonnet 4 (claude-sonnet-4-20250514)

## Price Calculation

The app calculates charges based on:
- Zone-based freight rates (Zones A-L)
- Weight tiers (1000+, 2000+, 5000+, 10000+ lbs)
- Fuel surcharge (adjustable, default 24%)
- Accessorial charges (liftgate, inside, residential, etc.)

## License

MIT
