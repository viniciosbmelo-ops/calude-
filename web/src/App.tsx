import { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { RefProvider } from './lib/ref';
import { Loading, ToastHost } from './components/ui';
import { Login } from './pages/Login';
import { Patients } from './pages/Patients';
import { PatientPage } from './pages/Patient';
import { EpisodePage } from './pages/Episode';
import { SurgeryPage } from './pages/Surgery';
import { Agenda } from './pages/Agenda';
import { Protocols } from './pages/Protocols';
import { Profile } from './pages/Profile';
import { PatientProm } from './pages/PatientProm';

export function App() {
  return (
    <>
      <Routes>
        {/* Rota pública do paciente: sem login, sem layout do médico */}
        <Route path="/p/:token" element={<PatientProm />} />
        <Route path="*" element={<AuthProvider><Private /></AuthProvider>} />
      </Routes>
      <ToastHost />
    </>
  );
}

function Private() {
  const { me, loading, mode } = useAuth();
  const loc = useLocation();
  if (mode === null || loading) return <Loading />;
  if (!me) return loc.pathname === '/login' ? <Login /> : <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return (
    <RefProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/pacientes" replace />} />
          <Route path="/login" element={<Navigate to="/pacientes" replace />} />
          <Route path="/pacientes" element={<Patients />} />
          <Route path="/pacientes/:id" element={<PatientPage />} />
          <Route path="/episodios/:id" element={<EpisodePage />} />
          <Route path="/cirurgias/:id" element={<SurgeryPage />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/protocolos" element={<Protocols />} />
          <Route path="/perfil" element={<Profile />} />
          <Route path="*" element={<div className="page"><h1>Página não encontrada</h1></div>} />
        </Routes>
      </Shell>
    </RefProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/pacientes" className="brand" style={{ textDecoration: 'none' }}><span className="brand-mark">DS</span><span>DocSholder</span></NavLink>
          <nav className="nav" aria-label="Principal">
            <NavLink to="/pacientes">Pacientes</NavLink>
            <NavLink to="/agenda">Seguimento</NavLink>
            <NavLink to="/protocolos">Protocolos</NavLink>
          </nav>
          <NavLink to="/perfil" className="small nowrap" title="Perfil">{me?.full_name ?? me?.email ?? 'Perfil'}</NavLink>
        </div>
      </header>
      {children}
    </>
  );
}
