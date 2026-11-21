import Link from "next/link";
import { Header } from "@/components/Header";
export default function GeenToegang() {
  return (<><Header /><main id="inhoud"><div className="container narrow"><div className="card stack"><h1>Geen toegang</h1><p>Je hebt geen rechten voor deze pagina.</p><Link className="btn" href="/">Naar de homepage</Link></div></div></main></>);
}
