import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Raiz from './Raiz.tsx'
import AccessGate from './AccessGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessGate><Raiz /></AccessGate>
  </StrictMode>,
)
