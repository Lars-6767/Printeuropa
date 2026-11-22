# Mijn Bereyl live zetten op mijn.bereyl.com

Drie onderdelen: een **VPS bij TransIP**, een **DNS-record** voor `mijn.bereyl.com` en **e-mail via Microsoft 365**. Reken op ongeveer een uur werk.

---

## 1. VPS bestellen bij TransIP

Bestel via **https://www.transip.nl/vps/** een VPS met:

| Keuze | Waarde |
|---|---|
| Geheugen / CPU | minimaal **4 GB RAM** en **2 CPU-kernen** |
| Opslag | minimaal 80 GB SSD |
| Besturingssysteem | **Ubuntu 24.04 LTS** |
| Locatie | Amsterdam (data blijft in Nederland) |

Noteer na de oplevering het **IPv4-adres** van de VPS en het root-wachtwoord of je SSH-sleutel.

## 2. DNS: mijn.bereyl.com naar de VPS

Ga naar de plek waar de DNS van `bereyl.com` wordt beheerd. Staat het domein bij TransIP, dan is dat *Controlepaneel → Domein en hosting → bereyl.com → DNS*. Voeg toe:

| Naam | Type | Waarde | TTL |
|---|---|---|---|
| `mijn` | `A` | *IPv4-adres van de VPS* | 1 uur |

Laat de bestaande records voor de website en de e-mail (MX, SPF, DKIM) ongewijzigd.

## 3. E-mail via Microsoft 365

De app verstuurt e-mail via de Microsoft Graph API met een eigen app-registratie. Er staat dus geen wachtwoord van een postbus op de server, en de koppeling blijft werken nu Microsoft het inloggen met alleen een wachtwoord op SMTP afbouwt.

Deze stappen voert een **Microsoft 365-beheerder** uit:

1. **Afzenderpostbus.** Maak in het *Exchange-beheercentrum* (admin.exchange.microsoft.com → Postbussen → Gedeelde postbus toevoegen) een gedeelde postbus `noreply@bereyl.com` aan. Een gedeelde postbus heeft geen licentie nodig.
2. **App-registratie.** Ga in *Microsoft Entra* (entra.microsoft.com) naar *Identiteit → Toepassingen → App-registraties → Nieuwe registratie*.
   - Naam: `Mijn Bereyl e-mail`, accounttype: *alleen accounts in deze organisatiemap*. Klik op *Registreren*.
   - Noteer op het overzicht de **Toepassings-id (client)** en de **Map-id (tenant)**.
3. **Toestemming.** Ga naar *API-machtigingen → Machtiging toevoegen → Microsoft Graph → Toepassingsmachtigingen* en kies **Mail.Send**. Klik daarna op **Beheerderstoestemming verlenen**.
4. **Geheim.** Kies *Certificaten en geheimen → Nieuw clientgeheim*, geldig 24 maanden. Kopieer meteen de **Waarde**; die wordt maar één keer getoond. Zet een herinnering om dit geheim op tijd te vernieuwen.
5. **Beperk de app tot de afzenderpostbus** (sterk aanbevolen). Zonder deze stap mag de app vanuit elke postbus mailen. In Exchange Online PowerShell:
   ```powershell
   Connect-ExchangeOnline
   New-ApplicationAccessPolicy -AppId <Toepassings-id> -PolicyScopeGroupId noreply@bereyl.com -AccessRight RestrictAccess -Description "Mijn Bereyl mag alleen als noreply mailen"
   ```
   Gebruiken jullie al *RBAC for Applications*, beperk de app dan op die manier tot deze ene postbus.

Op de server komen deze waarden in `.env.production`:

```
MAIL_FROM=Bereyl <noreply@bereyl.com>
MAIL_SENDER=noreply@bereyl.com
MS_TENANT_ID=<Map-id (tenant)>
MS_CLIENT_ID=<Toepassings-id (client)>
MS_CLIENT_SECRET=<waarde van het clientgeheim>
```

Omdat `bereyl.com` al via Microsoft 365 mailt, zijn SPF en DKIM normaal gesproken al goed. Controleer in het *Microsoft Defender-portaal → E-mail en samenwerking → Beleid → DKIM* dat DKIM voor bereyl.com **ingeschakeld** is. Anders kunnen inlogmails in de spam belanden.

## 4. De server inrichten

Log in op de VPS (`ssh root@<IPv4-adres>`) en voer uit:

```bash
# Updates, firewall en Docker
apt update && apt -y upgrade
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
curl -fsSL https://get.docker.com | sh

# Code ophalen (privé-repository: maak in GitHub een 'deploy key' of een token met alleen leesrechten)
git clone https://github.com/Lars-6767/Printeuropa.git /opt/mijn-bereyl
cd /opt/mijn-bereyl
git checkout claude/mijn-bereyl-webapp-q4hy6r   # of main, na samenvoegen

# Instellingen
cp .env.production.example .env.production
nano .env.production          # domein, databasewachtwoord en Microsoft 365-gegevens invullen
#  tip: databasewachtwoord maken met:  openssl rand -hex 24

# Starten
docker compose --env-file .env.production up -d --build
docker compose logs -f app    # wacht op "[controle] mailkoppeling werkt" en "Ready"
```

De app weigert te starten als de e-mailkoppeling niet werkt. Dat is bewust: zonder e-mail kan niemand inloggen. De logs vertellen dan precies wat er ontbreekt.

**Eerste beheerder aanmaken:**

```bash
docker compose exec app npm run admin -- jouw.naam@bereyl.com "Jouw Naam"
```

Je ontvangt een inlogmail. Open de link en je komt in het beheer op https://mijn.bereyl.com/beheer. Nodig daar collega's uit via *Instellingen → Gebruikers*.

## 5. Na de livegang

- **Beheer → Werkvoorraad → Activatiepunten:** stel de tarieven, de voorwaarden, de factuurgegevens (KvK, btw, IBAN) en de interne ontvangers in.
- **Beheer → Instellingen → Boxen en tarieven:** zet de echte boxfoto's erin. Upload de foto's bijvoorbeeld naar de Shopify-bestanden van bereyl.com en plak de link.
- **Link vanaf bereyl.com:** laat de knoppen "Inloggen" en "Box aanvragen" op de website verwijzen naar `https://mijn.bereyl.com/inloggen` en `https://mijn.bereyl.com/keuzehulp?box=250` (of 500 of 1000).
- **Back-ups:** die staan in het Docker-volume `backups`, 30 dagen lang. Kopieer ze geregeld naar een andere plek, bijvoorbeeld TransIP Stack.
- **Updaten:** `cd /opt/mijn-bereyl && git pull && docker compose --env-file .env.production up -d --build`.
