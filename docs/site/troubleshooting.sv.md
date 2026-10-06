# Felsökning

Börja med [statuslampan](status-led.md) — den är den enda återkoppling enheten
ger när ingen webbläsare är öppen, och den skiljer "ansluter fortfarande" från
"anslöt aldrig" med en blick. Det mesta som följer börjar med att läsa av den.

## Enheten hittas inte { #device-not-found }

| LED | Betydelse | Vad du gör |
|---|---|---|
| Blinkande rött | Försöker fortfarande gå med i ett nätverk | Vänta — inget att åtgärda ännu |
| Fast rött | Gav upp försöket; installationsportalen bör vara uppe | Se [Ansluta](connecting.md#the-setup-portal) |
| Blått | På installationsportalens eget nätverk | Den har inget skjutbanenätverk ännu — gå igenom installationen |
| Gult, och förblir så | På nätverket, men webbservern har inte kommit upp | Nätverkssidan är i sin ordning; det här är ett fel i enheten, inte i anslutningen |
| Grönt | Serverar | Enheten går att nå — om webbläsaren ändå inte når den, se nedan |

Om lampan är grön men `http://revolve-now.local` inte laddar, löser nätverket
inte upp mDNS-namnet åt dig — prova enhetens IP-adress direkt i stället (se
[Ansluta](connecting.md#finding-the-device)). Kontrollera att webbläsaren
verkligen är på samma nätverk som enheten, inte kvar på mobildata eller ett
tidigare WiFi.

## Tavlorna rör sig inte { #targets-not-moving }

- Prova **Vänd tavlorna** på Kör-sidan. Om inte heller det flyttar tavlorna är
  problemet inte det laddade programmet — kontrollera strömmen till
  tavelanläggningen och DB9-anslutningen (se [Hårdvara](hardware.md)).
- Om Vänd tavlorna fungerar men ett program inte flyttar dem, titta på
  programmets tidslinje: en händelse utan visa/dölj-kommando är en tidsstyrd
  paus med avsikt, inte ett fel.
- Om tavlorna rör sig, men åt fel håll — visas när de ska döljas, eller
  tvärtom — är det en inkopplingsinställning som sätts vid bygget, inte något
  som går att rätta från webbappen. Rapportera det i stället för att koppla om
  något.

## Inget ljud { #no-audio }

- Kontrollera att förstärkaren är strömsatt och ansluten — enheten kan inte
  upptäcka det på egen hand.
- Tyst fast förstärkaren har ström och stiften verkar rätt? Kontrollera
  masterklockan (MCLK) i [Expertläge](expert-mode.md#audio). Vissa DAC-kort,
  bland dem klubbens kretskort rev 1, spelar bara med den, och kan spela efter
  en omstart men inte efter ett strömavbrott.
- Vissa enheter byggs med ljudhårdvaran helt avstängd; en tavla som bara
  vänds, utan ljud, är en konfiguration som stöds på dem. Är det fallet för
  den här enheten finns det inget att åtgärda.
- Ett klipp som inte kan spelas upp (saknas, eller är inte en spelbar fil)
  rapporteras av enheten som en banner om **backend-problem** — för
  närvarande på Ljud-sidan, inte på Kör-sidan, så titta där om en körning
  blev tyst. <!-- TODO: confirm whether this should also surface on the Run page -->
- Själva körningen påverkas inte av att ett klipp inte spelas upp: den
  fortsätter tyst genom den händelsen i stället för att stanna.

## "Stop" säger att programmet inte körs (400) { #stop-says-the-program-is-not-running-400 }

`POST /programs/stop` — Pausa-åtgärden — svarar `400` när inget körs. Det är
väntat, inte ett fel, och dyker upp i ett fall en operatör faktiskt kommer att
råka ut för: **att trycka på Pausa efter att en serie redan har avslutats av
sig själv** — en serie som löper till slutet stoppar sig själv, så det finns
inget kvar att pausa. Om en serie till följer har enheten redan valt den och
väntar vid dess första händelse; tryck på Starta för att köra den. Var det den
sista serien är programmet klart — Starta skulle spela upp det från början
igen, eller Avlasta för att välja något annat.

## Skicka en felrapport { #sending-a-fault-report }

När enheten har betett sig fel och ingen på skjutbanan kan säga varför, skicka
ett **felsökningspaket** i stället för en beskrivning av symptomen. Det är en
zip-fil med vad enheten vet om sig själv — dess version, hur mycket minne och
lagring den har kvar, varför den senast startade om och vad den klagade på vid
uppstart — plus, om den kraschade, själva kraschdumpen.

Kraschdumpen är den del som betyder något, och den del som förr krävde en
kabel och en bärbar dator med utvecklarverktyg. Den måste också läsas mot
exakt den firmware som skapade den, vilket slutar vara firmwaren på kortet så
fort någon uppdaterar den — så paketet bär med sig den identiteten bredvid
dumpen.

**Så här laddar du ner ett:**

1. Tryck på enhetens **BOOT**-knapp — den lilla knappen bredvid USB-uttagen,
   märkt `BOOT` eller `FLASH` — **tre gånger inom tio sekunder.**
2. Öppna fliken **Expertläge** som dyker upp i webbappen och rulla ner till
   **Felsökning** längst ner.
3. Tryck på **Ladda ner felsökningspaket** och bifoga filen i ditt meddelande.

Fliken finns bara kvar i fem minuter efter de tre tryckningarna, och den dyker
inte upp alls medan ett program körs. Saknas den, tryck på knappen tre gånger
igen. [Expertläge](expert-mode.md) går igenom vad mer som finns där.

!!! warning "Vem du kan skicka det till"

    En kraschdump är en kopia av vad som fanns i enhetens minne i det
    ögonblick den fallerade, och det kan innefatta **WiFi-lösenordet**. Det är
    därför en nedladdning kräver att någon står vid kortet och trycker på dess
    knapp, och det är därför filen bör gå till någon du skulle berätta
    lösenordet för.
