import { useState } from "react";
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Gauge, LogOut, PackageSearch, Settings, X } from "lucide-react";
const groups = [
  { label: "Dashboard", items: [{ page: "Dashboard", icon: Gauge }] },
  { label: "TikTok Shop", items: [{ page: "TikTok Products", icon: PackageSearch }, { page: "TikTok Orders", icon: ClipboardList }, { page: "Daily Settlements", label: "Settlements & Profit", icon: BarChart3 }] },
  { label: "Analytics", items: [{ page: "Reports", icon: BarChart3 }] },
  { label: "Management", items: [{ page: "Settings", label: "Settings / Connection", icon: Settings }] },
];
const initialExpanded = () => { try { return JSON.parse(sessionStorage.getItem("rje_nav_groups")) || ["Sales & Orders", "Catalog & Inventory"]; } catch { return ["Sales & Orders", "Catalog & Inventory"]; } };
export default function Sidebar({ activePage, onNavigate, user, onLogout, isOpen, onClose }) {
  const [expanded, setExpanded] = useState(initialExpanded); const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem("rje_sidebar_collapsed") === "1");
  const toggleGroup = label => setExpanded(current => { const next = current.includes(label) ? current.filter(item => item !== label) : [...current, label]; sessionStorage.setItem("rje_nav_groups", JSON.stringify(next)); return next; });
  const toggleCollapsed = () => setCollapsed(value => { sessionStorage.setItem("rje_sidebar_collapsed", value ? "0" : "1"); return !value; });
  const navigate = page => { onNavigate(page); onClose(); };
  return <><button className={`sidebar-overlay ${isOpen ? "visible" : ""}`} type="button" aria-label="Close navigation" onClick={onClose} /><aside className={`sidebar ${isOpen ? "open" : ""} ${collapsed ? "collapsed" : ""}`} aria-label="Application navigation">
    <div className="brand"><img className="brand-logo" src="/rje-logo.png" alt="RJE Motorparts and Accessories" /><div className="brand-copy"><strong>RJE Sales</strong><small>Management System</small></div><button className="mobile-sidebar-close" onClick={onClose} aria-label="Close menu"><X size={18}/></button></div>
    <nav>{groups.map(group => { const visible = !group.admin || user?.role === "admin" || group.items.some(item => item.allRoles); const items = group.items.filter(item => !group.admin || user?.role === "admin" || item.allRoles); if (!visible) return null; const open = expanded.includes(group.label) || group.items.length === 1; const hasActive = items.some(item => item.page === activePage); return <div className={`nav-group ${hasActive ? "has-active" : ""}`} key={group.label}>
      {group.items.length > 1 && !collapsed ? <button className="nav-group-trigger" onClick={() => toggleGroup(group.label)} aria-expanded={open}><span>{group.label}</span><ChevronDown size={15} className={open ? "rotated" : ""}/></button> : !collapsed && <p className="nav-section-label">{group.label}</p>}
      <div className={`nav-group-items ${open || collapsed ? "expanded" : ""}`}>{items.map(item => { const Icon = item.icon; return <button title={collapsed ? item.label || item.page : undefined} className={`nav-item ${activePage === item.page ? "active" : ""}`} key={item.page} onClick={() => navigate(item.page)}><Icon className="nav-icon" size={18}/><span>{item.label || item.page}</span></button>; })}</div>
    </div>; })}</nav>
    <div className="sidebar-account"><div className="account-avatar">{user?.name?.charAt(0).toUpperCase() || "U"}</div><div className="account-copy"><strong>{user?.name}</strong><small>{user?.role}</small></div><button className="sidebar-logout" title="Log out" onClick={() => { onLogout(); onClose(); }}><LogOut size={17}/><span>Log out</span></button></div>
    <button className="sidebar-collapse" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronRight size={17}/> : <><ChevronLeft size={17}/><span>Collapse</span></>}</button>
  </aside></>;
}
