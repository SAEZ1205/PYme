import { useNavigate } from "react-router-dom";
import { BarChart3, Bot, Boxes, Calculator, ClipboardList, CreditCard, FileBarChart, PackagePlus, Receipt, Settings, ShoppingCart, TrendingUp } from "lucide-react";
import { PageContainer } from "../components/PageContainer";
const modules=[
  {to:'/caja',label:'Caja manual',desc:'Venta rápida sin IA',icon:ShoppingCart},
  {to:'/compras',label:'Compras',desc:'Mercadería e insumos',icon:PackagePlus},
  {to:'/gastos',label:'Gastos',desc:'Salidas del negocio',icon:Receipt},
  {to:'/movimientos',label:'Movimientos',desc:'Historial de Caja',icon:ClipboardList},
  {to:'/reportes',label:'Reportes',desc:'Hoy, semana y mes',icon:FileBarChart},
  {to:'/proyecciones',label:'Proyecciones',desc:'Estimaciones con datos',icon:TrendingUp},
  {to:'/recomendaciones',label:'Recomendaciones',desc:'Qué conviene revisar',icon:Bot},
  {to:'/inventario',label:'Productos y servicios',desc:'Precios, costos y stock',icon:Boxes},
];
export function MorePage(){const navigate=useNavigate();return <PageContainer><div className="space-y-4"><div><h1 className="text-2xl font-extrabold">Más herramientas</h1><p className="text-sm text-ink-soft">Todos los módulos usan la misma base local.</p></div><div className="grid grid-cols-2 gap-3">{modules.map(({to,label,desc,icon:Icon})=><button key={to} onClick={()=>navigate(to)} className="rounded-2xl bg-white border border-line p-4 text-left shadow-sm hover:-translate-y-0.5 transition"><span className="w-10 h-10 rounded-xl bg-primary-50 text-primary-700 grid place-items-center"><Icon size={20}/></span><strong className="block mt-3">{label}</strong><span className="text-xs text-ink-muted mt-1 block">{desc}</span></button>)}</div><section className="rounded-2xl bg-white border border-line p-4"><div className="flex gap-3"><Settings className="text-primary-700"/><div><h2 className="font-bold">Arquitectura funcional</h2><p className="text-sm text-ink-muted mt-1">Gemma interpreta; el sistema valida, pide confirmación y recién después actualiza Caja, inventario o fiados.</p></div></div></section></div></PageContainer>}
