import { useAuthStore } from "../../stores/authStore";
import { LogOut, Wifi, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";

export default function Header() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <div />
      <div className="flex items-center gap-4">
        <span className={`flex items-center gap-1.5 text-xs font-medium ${isOnline ? "text-green-600" : "text-orange-500"}`}>
          {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
          {isOnline ? "Online" : "Offline"}
        </span>
        <span className="text-sm text-gray-600">{user?.full_name}</span>
        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-500 capitalize">{user?.role}</span>
        <button onClick={handleLogout} className="text-gray-400 hover:text-gray-600 transition-colors">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
