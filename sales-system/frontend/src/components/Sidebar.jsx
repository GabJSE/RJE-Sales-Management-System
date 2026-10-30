import { Button } from "./ui/button.jsx";

const navigationItems = ["Dashboard", "Products", "Sales", "Inventory", "Reports"];

function Sidebar({ activePage, onNavigate, user, onLogout, isOpen, onClose }) {
  const navigate = (page) => {
    onNavigate(page);
    onClose();
  };
  return (
    <>
    <button className={`sidebar-overlay ${isOpen ? "visible" : ""}`} type="button" aria-label="Close navigation menu" onClick={onClose} />
    <aside className={`sidebar ${isOpen ? "open" : ""}`} aria-label="Application navigation">
      <div className="brand">
        <img className="brand-logo" src="/rje-logo.png" alt="RJE Motorparts and Accessories" />
        <div>
          <strong>RJE Sales</strong>
          <small>Management System</small>
        </div>
      </div>
      <p className="nav-section-label">Workspace</p>
      <nav aria-label="Main navigation">
        {navigationItems.map((item) => (
          <Button
            variant="ghost"
            size="sm"
            className={`nav-item ${activePage === item ? "active" : ""}`}
            key={item}
            onClick={() => navigate(item)}
          >
            <span className="nav-icon">{item === "Products" ? "▦" : item === "Dashboard" ? "⌂" : item === "Sales" ? "↗" : item === "Inventory" ? "▥" : "▤"}</span>
            {item}
          </Button>
        ))}
        {user?.role === "admin" && (
          <>
            <Button variant="ghost" size="sm" className={`nav-item ${activePage === "Users" ? "active" : ""}`} onClick={() => navigate("Users")}>
              <span className="nav-icon">◉</span>
              Users
            </Button>
            <Button variant="ghost" size="sm" className={`nav-item ${activePage === "Backup" ? "active" : ""}`} onClick={() => navigate("Backup")}>
              <span className="nav-icon">↥</span>
              Backup
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" className={`nav-item ${activePage === "Settings" ? "active" : ""}`} onClick={() => navigate("Settings")}>
          <span className="nav-icon">⚙</span>
          Settings
        </Button>
      </nav>
      {user && <div className="sidebar-account"><div className="account-avatar">{user.name?.charAt(0).toUpperCase() || "U"}</div><div className="account-copy"><strong>{user.name}</strong><small>{user.role}</small></div><Button variant="ghost" size="sm" className="nav-item" onClick={() => { onLogout(); onClose(); }}>Log out</Button></div>}
    </aside>
    </>
  );
}

export default Sidebar;
