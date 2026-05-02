import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { ResumenView }    from './pages/ResumenView'
import { TendenciaView }  from './pages/TendenciaView'
import { RegionesView }   from './pages/RegionesView'
import { VendedoresView } from './pages/VendedoresView'
import { ProductosView }  from './pages/ProductosView'
import { ClientesView }   from './pages/ClientesView'
import { AlertasView }    from './pages/AlertasView'
import { HallazgosView }     from './pages/HallazgosView'
import { OportunidadesView } from './pages/OportunidadesView'
import { AgenteView }        from './pages/AgenteView'
import { DimensionesView }   from './pages/DimensionesView'
import { MercadosView }      from './pages/MercadosView'
import { PresupuestoView }   from './pages/PresupuestoView'
import { DiccionarioView }       from './pages/DiccionarioView'
import { NotificacionesView }    from './pages/NotificacionesView'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index              element={<ResumenView />}    />
        <Route path="tendencia"   element={<TendenciaView />}  />
        <Route path="regiones"    element={<RegionesView />}   />
        <Route path="vendedores"  element={<VendedoresView />} />
        <Route path="productos"   element={<ProductosView />}  />
        <Route path="clientes"    element={<ClientesView />}   />
        <Route path="alertas"     element={<AlertasView />}    />
        <Route path="hallazgos"     element={<HallazgosView />}     />
        <Route path="oportunidades" element={<OportunidadesView />} />
        <Route path="agente"        element={<AgenteView />}        />
        <Route path="dimensiones"  element={<DimensionesView />}  />
        <Route path="mercados"     element={<MercadosView />}     />
        <Route path="presupuesto"  element={<PresupuestoView />}  />
        <Route path="diccionario"     element={<DiccionarioView />}     />
        <Route path="notificaciones"  element={<NotificacionesView />}  />
      </Route>
    </Routes>
  )
}
