import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'PULL — радар ликвидности',description:'Пулы, объём и риск для активных LP-позиций.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru" className="dark"><body>{children}</body></html>}
