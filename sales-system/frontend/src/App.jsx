import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Products from "./pages/Products.jsx";
import Sales from "./pages/Sales.jsx";
import Reports from "./pages/Reports.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Inventory from "./pages/Inventory.jsx";
import Users from "./pages/Users.jsx";
import Login from "./pages/Login.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import Settings from "./pages/Settings.jsx";
import { SettingsProvider } from "./context/SettingsContext.jsx";
import Backup from "./pages/Backup.jsx";
import DailySettlements from "./pages/DailySettlements.jsx";
import TikTokOrders from "./pages/TikTokOrders.jsx";
import TikTokProducts from "./pages/TikTokProducts.jsx";
import "./styles.css";
import "./design-system.css";

function PlaceholderPage({ title }) {
  return <section className="placeholder"><p className="eyebrow">Coming in the next phase</p><h1>{title}</h1><p className="muted">This page will be connected after the Products feature is complete.</p></section>;
}

function App() {
  const { user, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pageFromPath = () => {
    const page = { "/dashboard": "Dashboard", "/products": "TikTok Products", "/sales": "Sales", "/inventory": "Inventory", "/reports": "Reports", "/users": "Users", "/settings": "Settings", "/backup": "Backup", "/settings/tiktok": "Settings", "/tiktok/products": "TikTok Products", "/tiktok/orders": "TikTok Orders", "/tiktok/settlements": "Daily Settlements" }[window.location.pathname];
    return page || "Dashboard";
  };
  const [activePage, setActivePage] = useState(pageFromPath);
  useEffect(() => {
    const handlePopState = () => setActivePage(pageFromPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  useEffect(() => {
    if (activePage === "Users" && user.role !== "admin") navigate("Dashboard");
  }, [activePage, user.role]);
  const navigate = (page) => {
    const path = { Dashboard: "/dashboard", Products: "/products", Sales: "/sales", Inventory: "/inventory", Reports: "/reports", Users: "/users", Settings: "/settings", Backup: "/backup", "TikTok Shop": "/settings/tiktok", "TikTok Products": "/tiktok/products", "TikTok Orders": "/tiktok/orders", "Daily Settlements": "/tiktok/settlements" }[page] || "/";
    window.history.pushState({}, "", path);
    setActivePage(page);
  };

  return <div className="app-shell"><Sidebar activePage={activePage} onNavigate={navigate} user={user} onLogout={logout} isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} /><main className="main-content"><header className="mobile-header"><button className="menu-button" type="button" aria-label="Open navigation menu" aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen(true)}>☰</button><img className="mobile-logo" src="/rje-logo.png" alt="RJE Motorparts and Accessories" /><strong>RJE Sales</strong></header>{activePage === "Dashboard" ? <Dashboard /> : activePage === "TikTok Products" ? <TikTokProducts /> : activePage === "Products" ? <Products /> : activePage === "Sales" ? <Sales /> : activePage === "Inventory" ? <Inventory /> : activePage === "Reports" ? <Reports /> : activePage === "Users" ? <Users /> : activePage === "Settings" ? <Settings /> : activePage === "Backup" ? <Backup /> : activePage === "TikTok Orders" ? <TikTokOrders /> : activePage === "Daily Settlements" ? <DailySettlements /> : <PlaceholderPage title={activePage} />}</main></div>;
}

function AuthenticatedApp() {
  const { user, isLoading, logout } = useAuth();
  if (isLoading) return <div className="loading-screen">Loading session...</div>;
  if (!user) return <Login />;
  return <SettingsProvider><App logout={logout} /></SettingsProvider>;
}

export default function RootApp() {
  return <AuthProvider><AuthenticatedApp /></AuthProvider>;
}
