import App from './App';
import ControlFacturas from './ControlFacturas';
import { useRol } from './rol';

// Con la clave del depósito solo se ve «Control de entregas» (13-nov-2026, pedido de gax).
export default function Raiz() {
  const rol = useRol();
  if (rol !== 'deposito') return <App />;
  return (
    <div className="app-container">
      <header>
        <h1>🧾 Control de entregas</h1>
        <p className="subtitle">Acceso del depósito</p>
      </header>
      <ControlFacturas />
    </div>
  );
}
