# RJE Sales Management System

A full-stack sales, inventory, and business management system developed for **RJE Motorparts & Accessories**, a motorcycle parts and accessories business in the Philippines.

## Overview

The system is designed to replace manual spreadsheet-based sales tracking with a centralized application for managing products, sales transactions, inventory, financial reports, and business operations.

## Features

* Product Management
* Sales Transaction Management
* Automatic Sales and Profit Calculations
* Inventory Management
* Stock Movement History
* Dashboard and Business Analytics
* Sales and Inventory Reports
* User Authentication and Role-Based Access
* Business Settings
* CSV Data Export
* Database Backup and Recovery Procedures

## Technology Stack

### Frontend

* React
* Vite
* JavaScript
* CSS

### Backend

* Node.js
* Express.js
* Mongoose
* JWT Authentication
* bcryptjs

### Database

* MongoDB Atlas

## Business Calculations

* Total Sales = Quantity × Selling Price
* Total Capital = Quantity × Capital Price
* Net Sales = Total Sales − TikTok Fees
* Profit = Net Sales − Total Capital
* Profit Margin = (Profit ÷ Net Sales) × 100

Historical sales preserve their original price and fee snapshots to maintain accurate transaction records.

## Installation

### Clone the Repository

```bash
git clone YOUR_REPOSITORY_URL
cd RJE-Sales-Management-System
```

### Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file using `.env.example` as a reference.

Configure the required environment variables before starting the backend.

```bash
npm run dev
```

### Frontend Setup

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

The backend requires configuration for:

* PORT
* MONGODB_URI
* JWT_SECRET
* JWT_EXPIRES_IN

Never commit actual credentials or secrets.

## Project Status

Development and testing.

## License

Private repository. All rights reserved unless otherwise specified.
