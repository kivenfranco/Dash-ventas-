import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Layout }            from './components/layout/Layout'
import { LoginView }         from './pages/LoginView'
import { ResumenView }       from './pages/ResumenView'
import { TendenciaView }     from './pages/TendenciaView'
import { RegionesView }      from './pages/RegionesView'
import { VendedoresView }    from './pages/VendedoresView'
import { ProductosView }     from './pages/ProductosView'
import { ClientesView }      from './pages/ClientesView'
import { AlertasView }       from './pages/AlertasView'
import { HallazgosView }     from './pages/HallazgosView'
import { OportunidadesView } from './pages/OportunidadesView'
import { AgenteView }        from './pages/AgenteView'
import { DimensionesView }   from './pages/DimensionesView'
import { MercadosView }      from './pages/MercadosView'
import { PresupuestoView }   from './pages/PresupuestoView'
import { DiccionarioView }       from './pages/DiccionarioView'
import { NotificacionesView }    from './pages/NotificacionesView'
import { PronosticosView }       from './pages/PronosticosView'
import { ComercializacionView }  from './pages/ComercializacionView'
import { ScoreSaludView }        from './pages/ScoreSaludView'
import { RankingView }           from './pages/RankingView'
import { AnomalíasView }         from './pages/AnomalíasView'
import { CohortView }            from './pages/CohortView'
import { CanastaView }           from './pages/CanastaView'
import { SimuladorView }         from './pages/SimuladorView'
import { ReporteView }           from './pages/ReporteView'
import { RFMView }               from './pages/RFMView'
import { ABCXYZView }            from './pages/ABCXYZView'
import { CLVView }               from './pages/CLVView'
import { CrossSellingView }      from './pages/CrossSellingView'
import { ChurnView }             from './pages/ChurnView'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-500 border-t-transparent" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginView />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
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
          <Route path="pronosticos"        element={<PronosticosView />}        />
          <Route path="comercializacion"   element={<ComercializacionView />}   />
          <Route path="score-salud"        element={<ScoreSaludView />}         />
          <Route path="ranking"            element={<RankingView />}            />
          <Route path="anomalias"          element={<AnomalíasView />}          />
          <Route path="cohort"             element={<CohortView />}             />
          <Route path="canasta"            element={<CanastaView />}            />
          <Route path="simulador"          element={<SimuladorView />}          />
          <Route path="reporte"            element={<ReporteView />}            />
          <Route path="rfm"                element={<RFMView />}                />
          <Route path="abcxyz"             element={<ABCXYZView />}             />
          <Route path="clv"                element={<CLVView />}                />
          <Route path="cross-selling"      element={<CrossSellingView />}       />
          <Route path="churn"              element={<ChurnView />}              />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
