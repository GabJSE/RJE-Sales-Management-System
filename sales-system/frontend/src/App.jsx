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
import "./styles.css";

function PlaceholderPage({ title }) {
  return <section className="placeholder"><p className="eyebrow">Coming in the next phase</p><h1>{title}</h1><p className="muted">This page will be connected after the Products feature is complete.</p></section>;
}

function App() {
  const { user, logout } = useAuth();
  const pageFromPath = () => {
    const page = { "/dashboard": "Dashboard", "/products": "Products", "/sales": "Sales", "/inventory": "Inventory", "/reports": "Reports", "/users": "Users", "/settings": "Settings", "/backup": "Backup" }[window.location.pathname];
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
    const path = { Dashboard: "/dashboard", Products: "/products", Sales: "/sales", Inventory: "/inventory", Reports: "/reports", Users: "/users", Settings: "/settings", Backup: "/backup" }[page] || "/";
    window.history.pushState({}, "", path);
    setActivePage(page);
  };

  return <div className="app-shell"><Sidebar activePage={activePage} onNavigate={navigate} user={user} onLogout={logout} /><main className="main-content"><header className="mobile-header"><span className="brand-mark">R</span><strong>RJE Sales</strong></header>{activePage === "Dashboard" ? <Dashboard /> : activePage === "Products" ? <Products /> : activePage === "Sales" ? <Sales /> : activePage === "Inventory" ? <Inventory /> : activePage === "Reports" ? <Reports /> : activePage === "Users" ? <Users /> : activePage === "Settings" ? <Settings /> : activePage === "Backup" ? <Backup /> : <PlaceholderPage title={activePage} />}</main></div>;
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
