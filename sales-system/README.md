# RJE Sales Management System

Phase 1 implements the Products CRUD feature with a React/Vite frontend, Express API, and MongoDB database.

## Run locally

1. Install and start MongoDB locally, or replace `MONGODB_URI` in `backend/.env` with your MongoDB connection string.
2. In a terminal:

   ```bash
   cd sales-system/backend
   npm install
   npm run dev
   ```

3. In a second terminal:

   ```bash
   cd sales-system/frontend
   npm install
   npm run dev
   ```

4. Open `http://localhost:5173`.

The API is available at `http://localhost:5000/api/products`.
