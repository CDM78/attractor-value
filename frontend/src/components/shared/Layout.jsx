import { Outlet } from 'react-router-dom'
import Nav from './Nav'

export default function Layout() {
  return (
    <div className="min-h-screen bg-surface">
      <Nav />
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  )
}
