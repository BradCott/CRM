import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Toast from '../ui/Toast'
import { useApp } from '../../context/AppContext'

export default function AppShell() {
  const { toast } = useApp()

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Outlet />
      </div>
      {toast && <Toast message={toast.message} type={toast.type} key={toast.id} />}
    </div>
  )
}
