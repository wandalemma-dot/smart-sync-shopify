import { createContext, useContext } from 'react';

// Quién entró a la app (13-nov-2026): 'user' = clave principal; 'deposito' = clave del depósito,
// que solo ve «Carga y control de entregas» y no puede cambiar nada en Shopify. El servidor es el
// que realmente lo impide: esto solo esconde lo que igual le daría error.
export type Rol = 'user' | 'deposito';
export const RolContext = createContext<Rol>('user');
export const useRol = () => useContext(RolContext);
export const esDeposito = (rol: Rol) => rol === 'deposito';
