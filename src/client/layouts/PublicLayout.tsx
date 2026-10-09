import { Outlet } from 'react-router-dom';

export function PublicLayout() {
  return (
    <div className="public-shell">
      <div className="public-backdrop public-backdrop-a" />
      <div className="public-backdrop public-backdrop-b" />
      <Outlet />
    </div>
  );
}
