import { Outlet } from 'react-router-dom';
import Sidebar from './components/Sidebar';

export default function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 bg-gray-50 min-h-screen p-8">
        <Outlet />
      </main>
    </div>
  );
}
