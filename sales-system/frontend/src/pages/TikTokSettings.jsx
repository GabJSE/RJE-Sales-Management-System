import { useAuth } from "../context/AuthContext.jsx";
import { useEffect, useState } from "react";
import { disconnectTikTok, getTikTokAuthorizationUrl, getTikTokStatus, refreshTikTokShop } from "../services/tiktokService.js";

function TikTokSettings({ embedded = false }) {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadStatus = async () => {
    try { setLoading(true); setStatus(await getTikTokStatus()); }
    catch (error) { setNotice({ type: "error", text: error.message }); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadStatus(); }, []);

  const connect = async () => {
    try {
      setSaving(true);
      const { authorizationUrl } = await getTikTokAuthorizationUrl();
      window.location.assign(authorizationUrl);
    } catch (error) { setNotice({ type: "error", text: error.message }); setSaving(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect the authorized TikTok Shop?")) return;
    try { setSaving(true); await disconnectTikTok(); setNotice({ type: "success", text: "TikTok Shop disconnected." }); await loadStatus(); }
    catch (error) { setNotice({ type: "error", text: error.message }); }
    finally { setSaving(false); }
  };

  return <section className={embedded ? "embedded-module" : ""}>
    {!embedded && <div className="page-header"><div className="standard-page-title"><p className="eyebrow">Channel integration</p><h1>TikTok Shop</h1><p className="muted">Connect the authorized shop without exposing TikTok credentials to the browser.</p></div></div>}
    {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}
    <div className="panel settings-card">
      <p className="eyebrow">Marketplace integration</p><h2>TikTok Shop connection</h2><p className="muted">OAuth credentials remain encrypted on the server and are never returned to this page.</p>
      {loading ? <p className="empty-state">Checking TikTok Shop connection...</p> : status?.connected ? <>
        <p><strong>Connected</strong></p>
        <p className="muted">Shop: {status.shopName || "Refresh shop information to load the authorized shop."}</p>
        <p className="muted">Shop ID: {status.shopId || "Not available yet"}</p>
        <p className="muted">Region: {status.region || "Not available"}</p><p className="muted">Granted scopes: {status.scopes?.join(", ") || "Not returned by TikTok; verify in Partner Center"}</p>{user?.role === "admin" && <button disabled={saving} onClick={async () => { setSaving(true); try { await refreshTikTokShop(); await loadStatus(); } catch (error) { setNotice({ type: "error", text: error.message }); } finally { setSaving(false); } }}>Refresh shop information</button>}
        <button className="secondary-header-button" onClick={disconnect} disabled={saving}>{saving ? "Disconnecting..." : "Disconnect TikTok Shop"}</button>
      </> : <>
        <p className="muted">No TikTok Shop is connected.</p>
        <button className="primary-button" onClick={connect} disabled={saving}>{saving ? "Opening TikTok..." : "Connect TikTok Shop"}</button>
      </>}
    </div>
  </section>;
}

export default TikTokSettings;

