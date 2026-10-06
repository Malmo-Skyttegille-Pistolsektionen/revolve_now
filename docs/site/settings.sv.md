# Inställningar

Fliken Inställningar innehåller två olika sorters saker, och det är bra att
veta vilken som är vilken innan du ändrar något:

- **Webbläsarinställningar** bor i webbläsaren du använder. En annan telefon
  eller surfplatta på samma skjutbana har sina egna, och att rensa
  webbplatsdata nollställer dem.
- **Enhetsinställningar och avläsningar** kommer från kortet självt och är
  desamma för alla som tittar på det.

| Avsnitt | Sort | Vad det är |
|---|---|---|
| Serveradress (Server Base URL) | webbläsare | Vilken enhet den här webbläsaren pratar med |
| Tema | webbläsare | Ljust eller mörkt, eller det som den här telefonen eller datorn är inställd på |
| Språk | webbläsare | Engelska eller svenska, eller det som den här telefonen eller datorn är inställd på |
| Adress | enhet | Adressen enheten säger att den kan nås på |
| Kontrollås | enhet | Om styrningen är öppen för alla eller kräver inloggning |
| Startproblem | enhet | Vad enheten inte kunde läsa när den startade |
| Lagring | enhet | Hur mycket plats flashpartitionerna har |
| Nätverk | enhet | WiFi: vilket nätverk den är på och hur bra länken är. Ethernet: kabellänken och dess adress |
| Uppdatering | enhet | Installera en version från GitHub, eller ladda upp en OTA-fil |
| Om | enhet | Vilken firmware och webbapp det här är, och exakt vilket bygge |

![Sidan Inställningar](img/settings.png)

Inget på den här sidan kan få enheten att sluta fungera. De inställningar som
kan det — vilket nätverk den går med i, vilka stift den styr, och nedladdningen
av kraschdumpen — finns i [Expertläge](expert-mode.md), bakom ett knapptryck
på själva kortet.

**En rad kan dyka upp högst upp:** *Konfigurationen är sparad men inte
verkställd; starta om från Expertläge.* Den betyder att någon har ändrat en
inställning på den sidan och att enheten fortfarande kör med det den startade
med. Ändringen är inte förlorad och inget är trasigt — den behöver
[**Starta om för att verkställa**](expert-mode.md#restart-to-apply), som finns
på den sidan oavsett om femminutersfönstret fortfarande är öppet. Raden finns
här för att nästa person som tar upp enheten ska få veta det, i stället för att
bli överraskad vid nästa strömavbrott.

**Tavelgrupperna konfigureras också där.** Hur många linjer den här enheten
styr, vad var och en heter och vilket stift den sitter på är Expertläge-arbete
— [tavelgruppstabellen](expert-mode.md#the-target-banks) — eftersom ett
felaktigt stift är en av de inställningar där vägen tillbaka är en USB-kabel.
Det du ser på Kör-sidan — bokstavsremsan och knapparna per tavelgrupp — följer
av den och behöver inget som ställs in här.

## Serveradress (Server Base URL) { #server-base-url }

Normalt finns inget att göra här — appen pratar med det som serverade den. Det
spelar roll när appen körs någon annanstans ifrån än enheten (under utveckling,
eller från en kopia på en bärbar dator) och behöver pekas mot ett kort.

## Adress { #address }

Vad enheten rapporterar som sin egen adress. Om det står att enheten inte har
någon adress serverar den sin egen accesspunkt i stället för att vara på ett
nätverk — se [installationsportalen](connecting.md#the-setup-portal).

## Kontrollås { #control-lock }

Två lägen:

- **Helt öppet** — alla som kan nå sidan kan styra enheten. Det är
  standard, och det är oftast vad en skjutbana vill ha: inget lösenord att
  skicka runt medan folk skjuter.
- **Endast visning** — sidan visar fortfarande vad som händer, men att starta,
  stoppa, ladda upp och ta bort kräver alla inloggning.

När du slår på det ombeds du ange ett lösenord. Från och med då håller den
här webbläsaren en token; **Logga in** i en annan webbläsare frågar efter det
lösenordet igen.

Lösenordet skyddar mot misstag snarare än mot den beslutsamme: enheten sitter
på skjutbanans eget nätverk, och trafiken är okrypterad HTTP.

## Startproblem { #startup-issues }

Vad enheten inte kunde läsa när den startade: en programfil som inte går att
tolka, ett klipp vars huvud inte är en WAV den kan spela upp. Listan är
begränsad och släpper det äldsta, så en enhet med många trasiga filer visar de
senaste.

En tom lista är det normala tillståndet och säger att startgenomgången läste
allt.

## Lagring { #storage }

Partitionsstorlekar. Lägg märke till anmärkningen: **endast storlek — enheten
kan inte rapportera vad som används här** för vissa partitioner, så att en
siffra saknas är inte ett fel.

Den att titta på är **`userdata`**. Den innehåller det som har laddats upp till
enheten — program och ljudklipp — och inget annat. Allt som följer *med*
enheten ligger inuti själva firmwaren, så att den medföljande uppsättningen
växer kan inte längre äta upp utrymmet för ditt, och att uppdatera enheten kan
inte röra det du har lagt på den.

`ota_0` och `ota_1` är de två kopiorna av firmwaren. Den ena kör och den andra
är dit en uppdatering skrivs, vilket är det som gör att en dålig uppdatering
kan ångras. Att en av dem är nästan tom är normalt på en enhet som aldrig har
uppdaterats.

## Nätverk { #network }

Hur enheten är ansluten, i två halvor: WiFi, och Ethernet på en firmware som
stöder en [Ethernet-modul](hardware.md#ethernet). En enhet på båda har två
adresser, och båda når den. Att stänga av någon av dem görs i
[Expertläge](expert-mode.md#hardware).

### WiFi { #wifi }

Vilket nätverk enheten gick med i, hur stark signalen är, adressen den kan nås
på och MAC-adressen en router listar den under. Alltihop är en avläsning —
inget här ändrar något.

**Vilket nätverk spelar roll, inte bara att det finns ett.** En enhet kommer
ihåg nätverket den sattes upp på *och* det dess firmware byggdes för, och går
med i det den kan se. Ett kort som har varit på två ställen kan vara på
vilketdera som helst, och det är här du får veta vilket.

**Signal** visas som staplar och som ett tal i dBm. Talet är negativt och
närmare noll är starkare — runt −50 är utmärkt, −70 går att jobba med, och
under ungefär −80 är där en enhet börjar tappa nätverket. Det är siffran att
hålla ögonen på medan du flyttar runt ett kort och letar efter någonstans att
montera det.

Om det står att **inget nätverk har sparats** har ingen satt upp den här
enheten här. Den kör på det nätverk dess firmware byggdes för, vilket inte kan
läsas tillbaka eller ändras utan att bygga om den — så om den fungerar, så
fungerar den av den rena turen att stå i rätt byggnad.

För att *byta* nätverk, se [Expertläge](expert-mode.md#wifi). Det är ett beslut
per plats bakom knapptrycket på kortet, vilket är varför det inte finns på den
här sidan.

### Ethernet { #ethernet }

**Länk** säger om en kabel sitter i och något svarar i andra änden, och i
vilken hastighet; **Adress** är den routern gav den över kabeln. I stället kan
det stå att Ethernet är **avstängt**, eller att **ingen modul hittades** när
enheten startade — den letar bara då, så en modul som monteras senare kräver en
omstart.

Om WiFi är avstängt säger dess halva det. Enheten använder ändå WiFi när
kabeln inte ger någon adress, så den kan inte bli onåbar.

## Uppdatering { #update }

Att installera en uppdatering **startar om enheten**, så gör det mellan
skjutningar, inte under en; enheten vägrar medan ett program körs. Den skrivs
till den kopia av firmwaren som inte körs, så en uppdatering som inte vill
starta rullas tillbaka av sig själv. Webbappen och de medföljande programmen
och ljuden uppdateras med den; program och ljud ni laddat upp behålls.

**Från GitHub.** När Inställningar öppnas söker sidan efter versioner på
GitHub; *Sök igen* frågar en gång till. Välj en version för att läsa dess
versionsinformation. Installationen sker i två steg: *Ladda ner* sparar
versionens `revolve_now-<version>-ota.bin` på den här telefonen eller datorn,
och *Installera den nedladdade filen* skickar den till enheten. Sidan
kontrollerar först filen mot kontrollsumman som GitHub publicerat för
versionen, så en felaktig eller skadad fil avvisas innan enheten ser den.

Bara den här telefonen eller datorn behöver internet; enheten kontaktar aldrig
GitHub. Om sidan säger att den **inte når GitHub** ligger problemet här, inte
på enheten: en telefon på ett skyttebane-WiFi utan internet kan behöva få
besked om att stanna på nätverket, eller så hämtas filen någon annanstans och
laddas upp nedan.

**Att gå tillbaka till en äldre version** går, men frågar först. Nyare
versioner kan ändra hur inställningar och uppladdade program lagras, och en
äldre version kanske inte kan läsa dem: inställningar kan ignoreras eller
nollställas, program kan misslyckas att laddas, och i värsta fall behöver
enheten kabel och en fabriksflashning för att återställas.

**Från en fil.** Välj en `revolve_now-<version>-ota.bin` du redan har med
*Ladda upp OTA-fil*. Det kräver inget internet någonstans. `factory.bin` på en
versionssida är för kabel, inte för det här.

## Om { #about }

**App** är versionen av sidan du tittar på. **Enhet** är firmwarens. Ett enda
versionsnummer täcker firmware, webbapp och medföljande innehåll, och webbappen
är en del av själva firmware-avbilden — så en sida som serveras *av* enheten
stämmer alltid med den, hur enheten än har uppdaterats.

Det gäller även en uppdatering som skickats över nätet, som förr var det
krångliga fallet: den bytte ut firmwaren och lämnade webbappen kvar, så en
enhet kunde servera en sida som var äldre än firmwaren som körde den tills
någon flashade över den via USB. Det kan inte hända längre, och de medföljande
programmen och ljuden ligger i samma avbild, så de uppdateras tillsammans med
den.

Så en avvikelse betyder numera en enda sak: **den här sidan kom inte från den
enheten.** Ett utvecklingsbygge, eller en kopia som serveras från en bärbar
dator, pekad mot ett kort byggt från en annan commit.

En hård omladdning hjälper inte. Webbläsaren visar den version den fick; de
två är verkligen olika.

**Modifierat bygge** bredvid enhetsversionen betyder att firmwaren byggdes
från en arbetskopia med ändringar som inte var incheckade. På ett kort som
flashats från en release ska det inte dyka upp; på ett kort som någon har
utvecklat mot är det normalt.

### Bygginformation { #build-details }

**Bygginformation** öppnar en tabell som anger exakt vilket bygge det här är:
commiten, när det byggdes, vilken gren det kom från, ESP-IDF-versionen och
fingeravtryck av webbappen och ljudet det byggdes med.

Inget av det är värt att läsa till vardags. Det finns för en enda situation:
**ett kort som har kommit tillbaka från en skjutdag och beter sig konstigt.**
"Vilken firmware är det här" går att besvara utifrån versionen ensam; "vilken
commit, byggd var, med vilken ljuduppsättning" gör det inte, och det är de
frågorna som får ett fel diagnostiserat.

**Kopiera** lägger hela blocket på urklipp, redo att klistras in i en
felrapport — vilket är det enda det är till för. Om din webbläsare vägrar
(vissa gör det på en vanlig `http://`-adress, vilket är vad enheten serverar)
visas texten nedanför i stället så att du kan markera den för hand.

## Felsökning { #troubleshooting }

Nedladdningen av kraschdumpen har flyttat till
[Expertläge](expert-mode.md#troubleshooting). Den ligger bakom enhetens
BOOT-knapp eftersom en kraschdump kan innehålla WiFi-lösenordet, och allt som
ligger bakom den knappen finns nu på en sida i stället för att dyka upp och
försvinna på den här.

[Skicka en felrapport](troubleshooting.md#sending-a-fault-report) har stegen
och vad det innebär för den du skickar den till.
