# Jogu

En AI-träningscoach som bygger ett periodiserat träningsschema fram till ett målrace, och sedan ändrar schemat löpande utifrån hur träningen faktiskt går.

Tanken är att ersätta det statiska schemat. Säger du att du kände dig slutkörd efter ett långpass tittar coachen på de senaste veckornas belastning och föreslår konkreta ändringar i kommande pass. Du godkänner eller avslår varje förslag.

## Kom igång

```bash
npm install
npm run dev
```

Sidan startar på `http://localhost:5173`. Dev-servern lyssnar även på det lokala nätverket, så adressen som skrivs ut under `Network:` kan öppnas direkt i telefonen.

Utan API-nyckel kan du ladda ett exempelschema och klicka runt i hela gränssnittet. För att låta AI:n bygga ett riktigt schema behövs en nyckel från [console.anthropic.com](https://console.anthropic.com), som klistras in under Mer i appen.

Porten är låst till 5173 i `vite.config.ts`. Det är avsiktligt: all sparad träning ligger i webbläsaren knuten till exakt den adressen, så en port som flyttar sig får schemat att se ut som om det försvunnit.

## Publicerad version

Sajten ligger på [jogu.pages.dev](https://jogu.pages.dev) som en statisk sida på Cloudflare Pages.

```bash
npm run deploy   # bygger och laddar upp
```

Första gången på en ny dator behövs `npx wrangler login`, som kräver en riktig terminal.

Ikonerna för hemskärmen genereras från samma märke som `public/favicon.svg`:

```bash
npm run icons
```

## Så hänger det ihop

Tre principer styr designen:

**AI:n föreslår, appen bestämmer.** Coachen skriver aldrig om schemat direkt. Den returnerar ändringsoperationer (`add`, `update`, `remove`, `move`) som körs mot regelverket i `validation.ts` innan de ens visas. Bryter förslaget mot en regel får modellen tillbaka den exakta invändningen och ett nytt försök. Varje tillämpad ändring sparas med en ögonblicksbild så den kan ångras.

**Matematiken är deterministisk.** Veckotimmar, belastningstrend, andel hård träning och dagar till race räknas ut i TypeScript (`training.ts`). Modellen får färdiga siffror och behöver aldrig räkna.

**Planen finns även utan AI.** `plan-builder.ts` bygger ett komplett, regelriktigt schema helt utan modellanrop. Det driver exempelschemat och fungerar som reservlösning när ett anrop misslyckas.

Schemat detaljeras i två steg: först en veckoplan hela vägen till tävlingsdagen, sedan konkreta pass för den närmaste tiden. Det håller svaren inom modellens tokengräns och gör att kommande veckor kan skrivas ut med kunskap om hur träningen faktiskt gått.

## Kodkarta

| Sökväg | Innehåll |
| --- | --- |
| `src/lib/store.ts` | Enda stället som rör lagring. Byts localStorage ut påverkas bara den här filen. |
| `src/lib/actions.ts` | Alla skrivningar mot state går via dessa funktioner. |
| `src/lib/types.ts` | Datamodell och etiketter. |
| `src/lib/plan-builder.ts` | Deterministisk schemabyggare. |
| `src/lib/validation.ts` | Träningsreglerna som både AI-förslag och egna scheman prövas mot. |
| `src/lib/patch.ts` | Applicerar ändringsoperationer, med ångra-data. |
| `src/lib/training.ts` | Belastning, veckosummeringar och trender. |
| `src/lib/calendar.ts` | Export av passen till iCalendar. |
| `src/lib/ai/` | Anthropic-klient, prompter, JSON-scheman och coachlogiken. |
| `src/pages/` | De fem vyerna: Idag, Schema, Coach, Mål, Mer. |

## Varför Claude och inte någon annan modell

Appen är en ren statisk sida utan backend, vilket betyder att API-anropen sker från webbläsaren. Anthropic är den enda av de stora leverantörerna som uttryckligen tillåter det, via headern `anthropic-dangerous-direct-browser-access`. Nyckeln sparas bara i användarens egen webbläsare och följer aldrig med i en säkerhetskopia.

Modellnamn hårdkodas inte. Appen frågar nyckeln vilka modeller den har tillgång till och väljer en stark för planering och en snabbare för samtal.

## Kontroller

```bash
npm run check   # typkontroll + validering av genererade scheman
npm run lint
npm run build
```

`npm run check` bygger scheman för åtta olika atletprofiler och racetyper och prövar samtliga mot träningsreglerna. Det fångar upp trasig periodisering som en typkontroll aldrig hade sett.

## Begränsningar

- Data ligger i webbläsarens `localStorage`. Rensas webbläsardata försvinner allt, så gör en säkerhetskopia ibland.
- En hemsida kan inte skicka påminnelser av sig själv. Passen exporteras därför till telefonens kalender, som sköter notiserna.
- Strava-integration är utesluten: deras API-policy förbjuder att data skickas vidare till AI-modeller. Garmins API kräver företagsavtal.
- Verktyget ger träningsplanering, inte medicinska råd.
