import { redirect } from "next/navigation";
// Wachtwoorden bestaan niet meer: oude links gaan naar inloggen met een e-maillink.
export default function Wachtwoord() { redirect("/inloggen"); }
