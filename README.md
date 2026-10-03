# RJE Sales Management System

A full-stack sales, inventory, and business management application developed for **RJE Motorparts & Accessories**, a motorcycle parts and accessories business in the Philippines.

The system is designed to simplify daily business operations by centralizing product management, sales transactions, inventory monitoring, financial calculations, reporting, and data management.

---

## Project Overview

The RJE Sales Management System replaces manual spreadsheet-based tracking with a centralized web application.

It enables the business to monitor sales performance, calculate profit, manage motorcycle parts inventory, and maintain organized transaction records.

The system also supports multi-product transactions, allowing multiple products from a single customer order to be recorded under one transaction.

## Features

### 1. Product Management

* Add, view, edit, and delete products.
* Manage product brand, model, SKU, and category.
* Record capital and selling prices.
* Monitor available stock.
* Bulk product import using Excel or CSV templates.

### 2. Sales Management

* Record sales transactions.
* Support multiple products within one transaction.
* Manage product quantities.
* Automatically calculate sales, capital, fees, and profit.
* Track TikTok fees and withholding tax.
* View transaction details and history.
* Edit and delete transactions with inventory adjustments.

### 3. Inventory Management

* Automatic stock deduction after sales.
* Stock restoration when transactions are canceled.
* Manual stock-in and stock adjustments.
* Inventory movement history.
* Low-stock and out-of-stock monitoring.

### 4. Dashboard

* Total sales overview.
* Total capital and expenses.
* Net sales and profit.
* Profit margin.
* Sales trends.
* Recent transactions.
* Top-performing products.
* Inventory status.

### 5. Reports and Analytics

* Daily, weekly, monthly, and yearly reports.
* Custom date range filtering.
* Product performance analysis.
* Sales and profit summaries.
* CSV export.

### 6. Authentication and User Management

* Secure login.
* JWT-based authentication.
* Password hashing.
* Role-based access control.
* User account management.

### 7. Business Settings

* Business configuration.
* Currency and display preferences.
* Default business settings.
* User profile management.

### 8. Data Export and Backup

* Export business records.
* Database backup functionality.
* Backup history and management.

---

## Technology Stack

| Component         | Technology           |
| ----------------- | -------------------- |
| Frontend          | React                |
| Build Tool        | Vite                 |
| Backend           | Node.js              |
| API Framework     | Express.js           |
| Database          | MongoDB Atlas        |
| ODM               | Mongoose             |
| Authentication    | JSON Web Token (JWT) |
| Password Security | bcryptjs             |
| API Communication | REST API             |
| Version Control   | Git and GitHub       |

---

## Project Structure

```text
RJE-Sales-Management-System/
│
└── sales-system/
    │
    ├── backend/
    │   ├── config/
    │   ├── controllers/
    │   ├── middleware/
    │   ├── models/
    │   ├── routes/
    │   ├── scripts/
    │   ├── package.json
    │   └── server.js
    │
    ├── frontend/
    │   ├── public/
    │   ├── src/
    │   │   ├── components/
    │   │   ├── context/
    │   │   ├── pages/
    │   │   ├── services/
    │   │   ├── App.jsx
    │   │   ├── main.jsx
    │   │   └── styles.css
    │   ├── package.json
    │   └── vite.config.js
    │
    └── README.md
```

---

## System Requirements

Before installing, ensure that the following are available:

* Node.js and npm
* MongoDB Atlas account
* Git
* Modern web browser
* Code editor such as Visual Studio Code

---

## Installation and Setup

### 1. Clone the Repository

```bash
git clone https://github.com/GabJSE/RJE-Sales-Management-System.git
```

Navigate to the project directory:

```bash
cd RJE-Sales-Management-System/sales-system
```

### 2. Backend Installation

Navigate to the backend folder:

```bash
cd backend
```

Install dependencies:

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file inside the backend directory.

```env
PORT=5000

MONGODB_URI=your_mongodb_atlas_connection_string

JWT_SECRET=your_long_random_secret

JWT_EXPIRES_IN=1d
```

Replace the placeholder values with your actual configuration.

**Important:** Never upload your actual `.env` file, database credentials, or JWT secret to GitHub.

### 4. Start the Backend

```bash
npm run dev
```

The backend should run at:

```text
http://localhost:5000
```

### 5. Frontend Installation

Open another terminal and navigate to the frontend directory:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

### 6. Start the Frontend

```bash
npm run dev
```

Open the application in your browser:

```text
http://localhost:5173
```

---

## Business Calculation Logic

The system uses the following formulas for sales and profitability.

| Metric        | Formula                    |
| ------------- | -------------------------- |
| Total Sales   | Quantity × Selling Price   |
| Total Capital | Quantity × Capital Price   |
| Net Sales     | Total Sales − TikTok Fees  |
| Profit        | Net Sales − Total Capital  |
| Profit Margin | (Profit ÷ Net Sales) × 100 |

For multi-product transactions, the system aggregates the values of all product line items.

Historical transactions preserve their recorded selling price and capital price snapshots to prevent changes in current product prices from altering past financial records.

---

## Database

The application uses **MongoDB Atlas** as its cloud database.

Database records include:

* Products
* Sales Transactions
* Inventory Movements
* User Accounts
* System Settings
* Backup Logs

Ensure that your MongoDB Atlas network access and database user permissions are configured correctly.

---

## Development Status

**Current Stage:** Development, Testing, and Optimization

The system is being developed and validated through the following phases:

* Product Management
* Sales Management
* Reports
* Dashboard
* Inventory Management
* Authentication and User Management
* Business Settings
* Data Export and Backup
* Testing and Optimization
* Deployment

---

## Security

* Passwords are hashed before storage.
* JWT is used for authentication.
* Protected routes enforce access permissions.
* Environment variables store sensitive configuration.
* Backend validation is used for business operations.

---

## Future Improvements

Potential future enhancements include:

* Production deployment.
* Multi-device access.
* Advanced sales analytics.
* Improved bulk import and export.
* Automated backup scheduling.
* Enhanced transaction management.

---

## Developer

**Project:** RJE Sales Management System

**Business:** RJE Motorparts & Accessories

**Location:** Bugallon, Pangasinan, Philippines

**Developer:** Gabriel Jose S. Esperanza

---

## License

This project is currently maintained as a private business application.

All rights reserved unless otherwise specified.
