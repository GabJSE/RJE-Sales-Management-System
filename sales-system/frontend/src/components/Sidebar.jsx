const navigationItems = ["Dashboard", "Products", "Sales", "Inventory", "Reports"];

function Sidebar({ activePage, onNavigate, user, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">R</span>
        <div>
          <strong>RJE Sales</strong>
          <small>Management System</small>
        </div>
      </div>
      <p className="nav-section-label">Workspace</p>
      <nav aria-label="Main navigation">
        {navigationItems.map((item) => (
          <button
            className={`nav-item ${activePage === item ? "active" : ""}`}
            key={item}
            onClick={() => onNavigate(item)}
          >
            <span className="nav-icon">{item === "Products" ? "▦" : item === "Dashboard" ? "⌂" : item === "Sales" ? "↗" : item === "Inventory" ? "▥" : "▤"}</span>
            {item}
          </button>
        ))}
      </nav>
      {user && <div className="sidebar-account"><div className="account-avatar">{user.name?.charAt(0).toUpperCase() || "U"}</div><div className="account-copy"><strong>{user.name}</strong><small>{user.role}</small></div>{user.role === "admin" && <><button className={`nav-item ${activePage === "Users" ? "active" : ""}`} onClick={() => onNavigate("Users")}>Users</button><button className={`nav-item ${activePage === "Backup" ? "active" : ""}`} onClick={() => onNavigate("Backup")}>Backup</button></>}<button className={`nav-item ${activePage === "Settings" ? "active" : ""}`} onClick={() => onNavigate("Settings")}>Settings</button><button className="nav-item" onClick={onLogout}>Log out</button></div>}
    </aside>
  );
}

export default Sidebar;
